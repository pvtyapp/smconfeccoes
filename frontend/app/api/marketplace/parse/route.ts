import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getDocumentProxy, extractText } from "unpdf"
import { pool } from "@/lib/db"
import { buildMatchKey } from "@/lib/marketplaceMatchKey"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type CatalogVariant = {
  variantId: string; productId: string; productName: string; categoryName: string
  color: string; size: string; sku: string; availableStock: number
}
type AssociationItem = { productId: string; productName: string; qty: number }
type Association = {
  prefix: string; kind: "single" | "kit"
  productId: string | null; productName: string | null // 'single'
  items: AssociationItem[] // 'kit'
}

// `variacao` é o campo que carrega cor/tamanho de verdade (ex: "Camiseta
// Rosa,TAM. 4", "KIT Bordo,TAM.12", ou só "Preto,G") — quando o picklist tem
// esse campo (comum no export do UpSeller), ele pesa mais que o título pra
// decidir a variante. `title` (nome do anúncio) é só descritivo, nunca decide.
type ExtractedRow = { raw: string; sku: string; title: string; variacao: string; qty: number }
type ReviewRow = {
  raw: string
  title: string // nome do anúncio — mostrado na conferência, mas não pesa no casamento
  variacao: string // cor/tamanho como veio no picklist — é o que decide, junto do SKU
  marketplaceSku: string // SKU original do picklist — sempre preservado, é ele que vira prefixo de associação
  variantId: string | null
  productName: string | null; color: string | null; size: string | null; sku: string | null
  categoryName: string | null // pra agrupar a tela de conferência em blocos
  stock: number | null
  qty: number
  source: "regra" | "ia" | "memoria" | null
  unresolved: boolean
  isKit: boolean // true pra cada peça de uma linha de kit (marketplaceSku repetido entre as peças)
  qtyPerKit: number // proporção da peça dentro de 1 kit (não a qty final da linha) — usada pra gravar a memória certa
  timesUsed: number | null // só quando source === "memoria": quantas vezes esse SKU já foi confirmado antes
}

// ── Memória de SKU exato — aprendida em /api/marketplace/confirm toda vez que
// uma separação é confirmada. Item idêntico (mesmo SKU + mesma Variação) a um
// upload anterior pula a IA inteiramente (lookup determinístico).
//
// A chave NÃO é o SKU sozinho: testado com picklist real de produção, achamos
// o mesmo "SKU do Anúncio" repetido em 6 linhas apontando pra 6 combinações de
// cor/tamanho diferentes (o vendedor reaproveita 1 SKU pra todas as variações
// do produto) — exatamente o padrão que já fazia a IA desconfiar do SKU
// sozinho. A chave real é SKU+Variação (ver lib/marketplaceMatchKey).
//
// Só confia se TODAS as peças daquele item (kit ou não) ainda apontarem pra
// variante/produto ativos — se uma peça sumiu do catálogo, invalida a entrada
// inteira e deixa cair no fluxo normal. ──────────────────────────────────────
type MemoryRaw = { matchId: number; matchKey: string; isKit: boolean; timesUsed: number; variantId: string; productId: string; qtyPerKit: number }
type MemoryMatch = { isKit: boolean; timesUsed: number; items: { variantId: string; productId: string; qtyPerKit: number }[] }

function buildMemoryMap(raw: MemoryRaw[], catalog: CatalogVariant[]): Map<string, MemoryMatch> {
  const byId = new Map<number, MemoryMatch & { matchKey: string }>()
  for (const r of raw) {
    if (!byId.has(r.matchId)) byId.set(r.matchId, { matchKey: r.matchKey, isKit: r.isKit, timesUsed: r.timesUsed, items: [] })
    byId.get(r.matchId)!.items.push({ variantId: r.variantId, productId: r.productId, qtyPerKit: r.qtyPerKit })
  }
  const validIds = new Set(catalog.map(c => c.variantId))
  const byKey = new Map<string, MemoryMatch>()
  for (const m of byId.values()) {
    if (m.items.length > 0 && m.items.every(it => validIds.has(it.variantId))) byKey.set(m.matchKey, m)
  }
  return byKey
}

// ── Extração de linhas — heurística de CSV, sem lib externa (a lib xlsx
// disponível no npm tem CVE alto ainda sem correção publicada lá, por isso
// v1 aceita CSV/texto colado — cobre o export do Shopee/ML tranquilamente) ──
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes; continue }
    if (c === delim && !inQuotes) { out.push(cur.trim()); cur = ""; continue }
    cur += c
  }
  out.push(cur.trim())
  return out
}

function detectDelimiter(line: string): string {
  const candidates = [",", ";", "\t"]
  return candidates.reduce((best, d) => (line.split(d).length > line.split(best).length ? d : best), ",")
}

const HEADER_HINTS = {
  sku: ["sku", "código", "codigo", "seller sku", "código do produto", "id do anúncio", "id do produto"],
  title: ["título", "titulo", "produto", "nome", "descrição", "descricao", "item", "anúncio", "anuncio"],
  variacao: ["variação", "variacao", "variation"],
  qty: ["quantidade", "qtd", "qty", "quant"],
}

function extractRows(text: string): ExtractedRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const delim = detectDelimiter(lines[0])
  const parsed = lines.map(l => splitCsvLine(l, delim))
  const width = Math.max(...parsed.map(r => r.length))
  if (width < 2) {
    // Sem estrutura de coluna nenhuma — trata cada linha como "título livre", qty 1
    return parsed.map(r => ({ raw: r[0], sku: "", title: r[0], variacao: "", qty: 1 }))
  }

  // Tenta achar cabeçalho na primeira linha
  const firstLower = parsed[0].map(c => c.toLowerCase())
  let skuCol = firstLower.findIndex(c => HEADER_HINTS.sku.some(h => c.includes(h)))
  let titleCol = firstLower.findIndex(c => HEADER_HINTS.title.some(h => c.includes(h)))
  const variacaoCol = firstLower.findIndex(c => HEADER_HINTS.variacao.some(h => c.includes(h)))
  let qtyCol = firstLower.findIndex(c => HEADER_HINTS.qty.some(h => c.includes(h)))
  const hasHeader = skuCol >= 0 || titleCol >= 0 || variacaoCol >= 0 || qtyCol >= 0
  const dataRows = hasHeader ? parsed.slice(1) : parsed

  if (!hasHeader) {
    // Sem cabeçalho reconhecido — adivinha por conteúdo: coluna mais numérica = qty,
    // coluna mais curta e "code-like" = sku, a mais longa = título.
    const numericScore = (i: number) => dataRows.filter(r => /^\d+$/.test(r[i] ?? "")).length
    const avgLen = (i: number) => dataRows.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / dataRows.length
    qtyCol = Array.from({ length: width }, (_, i) => i).sort((a, b) => numericScore(b) - numericScore(a))[0]
    const remaining = Array.from({ length: width }, (_, i) => i).filter(i => i !== qtyCol)
    skuCol = remaining.sort((a, b) => avgLen(a) - avgLen(b))[0]
    titleCol = remaining.find(i => i !== skuCol) ?? skuCol
  }

  return dataRows
    .filter(r => r.some(c => c))
    .map(r => {
      const sku = skuCol >= 0 ? (r[skuCol] ?? "") : ""
      const title = titleCol >= 0 ? (r[titleCol] ?? "") : r.join(" ")
      const variacao = variacaoCol >= 0 ? (r[variacaoCol] ?? "") : ""
      const qtyRaw = qtyCol >= 0 ? (r[qtyCol] ?? "") : ""
      const qty = Math.max(1, parseInt(qtyRaw.replace(/\D/g, ""), 10) || 1)
      return { raw: r.join(" " + delim + " "), sku: sku.trim(), title: title.trim(), variacao: variacao.trim(), qty }
    })
}

// ── Pista pelo prefixo do SKU — não decide mais nada sozinha, só cochicha
// pra IA qual produto (ou quais peças de kit) o código costuma indicar.
// Quem sempre lê cor/tamanho de verdade é a IA, olhando o título. ──────────
type RowHint =
  | { kind: "single"; productId: string; productName: string }
  | { kind: "kit"; items: AssociationItem[] }
  | null

function findHint(row: ExtractedRow, associations: Association[]): RowHint {
  if (!row.sku) return null
  const skuUpper = row.sku.toUpperCase()
  const hit = associations
    .filter(a => skuUpper.startsWith(a.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] // prefixo mais específico primeiro
  if (!hit) return null
  if (hit.kind === "kit") return hit.items.length > 0 ? { kind: "kit", items: hit.items } : null
  return hit.productId && hit.productName ? { kind: "single", productId: hit.productId, productName: hit.productName } : null
}

// ── Casamento — tudo passa pela IA numa chamada só pro arquivo inteiro. A
// pista do SKU (quando existe) entra como contexto forte no prompt, não como
// portão que decide sozinho — é a IA que sempre lê o título de verdade.
// Pra linha de kit, a IA devolve 1 pick por peça, na mesma ordem da pista. ──
async function matchAllRows(extracted: ExtractedRow[], hints: RowHint[], catalog: CatalogVariant[]): Promise<ReviewRow[]> {
  // Catálogo de referência agrupado por produto (não uma lista corrida) — mais
  // fácil da IA escanear sem trocar tamanho/cor de produto parecido.
  const byProduct = new Map<string, CatalogVariant[]>()
  for (const c of catalog) {
    if (!byProduct.has(c.productName)) byProduct.set(c.productName, [])
    byProduct.get(c.productName)!.push(c)
  }
  const catalogCompact = [...byProduct.entries()]
    .map(([name, vs]) => `## ${name}\n${vs.map(v => `${v.variantId}|${v.color}|${v.size}`).join("\n")}`)
    .join("\n\n")

  // A pista aponta só o NOME do produto — as variantes já estão listadas uma
  // vez só lá em cima (catalogCompact), agrupadas por produto. Repetir a
  // lista inteira em cada uma das dezenas de linhas do picklist (testado:
  // ~50 linhas × 30 itens) sobrecarrega o prompt de blocos quase idênticos e
  // faz a IA confundir tamanho de uma peça com outra — pior do que não repetir.
  const rowsCompact = extracted.map((r, i) => {
    const hint = hints[i]
    const varLine = r.variacao ? ` VARIAÇÃO:"${r.variacao}"` : ""
    const header = `${i}) SKU:"${r.sku}"${varLine} TÍTULO:"${r.title}"`
    if (!hint) return `${header}\nPISTA_DO_CÓDIGO: (nenhuma — procure no catálogo completo acima)`
    if (hint.kind === "single") {
      return `${header}\nPISTA_DO_CÓDIGO: ${hint.productName} (ver seção "## ${hint.productName}" no catálogo acima)`
    }
    const kitLine = hint.items.map((it, j) => `Peça ${j}: ${it.productName} (${it.qty}x)`).join(", ")
    return `${header}\nPISTA_DO_CÓDIGO: KIT com ${hint.items.length} peça(s) — ${kitLine} (ver as seções correspondentes no catálogo acima)`
  }).join("\n\n")

  const system = `Você lê um picklist de marketplace (Shopee/Mercado Livre) de uma confecção e acha, pra cada item, a variante certa no catálogo interno.

Catálogo completo, agrupado por produto (variantId|cor|tamanho):
${catalogCompact}

Cada item do picklist abaixo tem até 3 campos — em ordem de confiança, do mais pro menos importante:
1. VARIAÇÃO — quando existe, é a fonte MAIS confiável. Normalmente já vem estruturada como "cor,tamanho" (às vezes com uma palavra de produto ou "KIT" na frente, às vezes o tamanho vem como "TAM.8" ou só "8"). Extraia cor e tamanho dali primeiro.
2. SKU — muitas vezes repete a mesma cor/tamanho da Variação grudada no final do texto (ex: "...-Camiseta Rosa-TAM. 4") — serve pra confirmar. Não confie no SKU sozinho pra decidir produto: o mesmo SKU às vezes é reaproveitado pra vários produtos/variações diferentes.
3. TÍTULO do anúncio — é só nome de marketing (pode citar personagem/estampa que não existe como opção no catálogo). Não pesa pra decidir cor ou tamanho — só ajuda a confirmar o produto quando não tem PISTA_DO_CÓDIGO nem Variação suficiente.

PISTA_DO_CÓDIGO (quando existe) é um palpite de produto pelo prefixo do SKU — pode estar errada. Ela aponta pra qual seção do catálogo acima procurar (ex: "## Camisetas Infantil"). Use como atalho pra ir direto na seção certa, nunca como verdade absoluta — a grafia de cor/tamanho na Variação/SKU manda mais.

Regras:
- Cor e tamanho da Variação/SKU podem não bater letra por letra com o catálogo (ex: "Rosa" no picklist vs "Rosa Bebe" no catálogo, ou "Bege" vs "Begê") — use bom senso pra reconhecer que é a mesma cor quando não houver outra opção parecida, mas nunca invente uma cor/tamanho que não tem nenhuma relação com o texto.
- Preste atenção redobrada no tamanho: "8" é diferente de "6", "10" é diferente de "12" — não troque por um vizinho.
- Kit: cada peça é julgada separada. Se só tem informação (Variação/título) suficiente pra ALGUMAS peças do kit, resolva as que der e devolva null pras que não tiverem informação própria — NÃO reaproveite cor/tamanho de uma peça pra outra sem confirmação explícita pra cada uma.
- Só devolva um variantId quando tiver certeza razoável. Sem certeza, devolva null. Não é permitido chutar.

Responda APENAS um JSON:
{"matches":[{"index":0,"picks":[{"variantId":"<uuid ou null>"}]}]}
(picks tem 1 item pra item normal, N itens pra kit — 1 por peça, na ordem da pista)`

  // Sonnet aqui, não Haiku — testado com dado real de produção: Haiku confunde
  // tamanho/cor entre linhas parecidas quando o picklist tem muitas linhas com
  // estrutura repetida (mesmo SKU ou mesmo kit várias vezes seguidas — comum
  // em export de verdade). Essa etapa decide o que desconta do estoque, então
  // vale o custo do modelo maior.
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16_000,
    system,
    messages: [{ role: "user", content: rowsCompact }],
  })
  const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")
  const raw = textBlock?.text ?? ""
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return extracted.map((r, i) => buildUnresolved(r, hints[i]))

  let matches: { index: number; picks: { variantId: string | null }[] }[] = []
  try {
    matches = (JSON.parse(jsonMatch[0]) as { matches: typeof matches }).matches ?? []
  } catch {
    return extracted.map((r, i) => buildUnresolved(r, hints[i]))
  }

  return extracted.flatMap((row, i): ReviewRow[] => {
    const hint = hints[i]
    const m = matches.find(x => x.index === i)
    const picks = m?.picks ?? []

    if (hint?.kind === "kit") {
      // 1 pick por peça — o que faltar ou não bater vira 1 linha de atenção só daquela peça
      return hint.items.map((comp, j): ReviewRow => {
        const pickedId = picks[j]?.variantId
        const variant = pickedId ? catalog.find(c => c.variantId === pickedId && c.productId === comp.productId) : null
        const qty = row.qty * comp.qty
        if (variant) {
          return {
            raw: row.raw, title: row.title, variacao: row.variacao, marketplaceSku: row.sku, variantId: variant.variantId,
            productName: variant.productName, color: variant.color, size: variant.size, sku: variant.sku, categoryName: variant.categoryName,
            stock: variant.availableStock, qty, source: "regra", unresolved: false, isKit: true, qtyPerKit: comp.qty, timesUsed: null,
          }
        }
        return {
          raw: row.raw, title: `${row.title} — peça do kit: ${comp.productName} (cor/tamanho não identificados)`, variacao: row.variacao,
          marketplaceSku: row.sku, variantId: null, productName: null, color: null, size: null, sku: row.sku || null, categoryName: null,
          stock: null, qty, source: null, unresolved: true, isKit: true, qtyPerKit: comp.qty, timesUsed: null,
        }
      })
    }

    const pickedId = picks[0]?.variantId
    const variant = pickedId ? catalog.find(c => c.variantId === pickedId) : null
    if (!variant) return [buildUnresolved(row, hint)]
    return [{
      raw: row.raw, title: row.title, variacao: row.variacao, marketplaceSku: row.sku, variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, categoryName: variant.categoryName, stock: variant.availableStock,
      qty: row.qty, source: hint ? "regra" : "ia", unresolved: false, isKit: false, qtyPerKit: 1, timesUsed: null,
    }]
  })
}

// ── PDF: pdf.js (via unpdf, sem dependência nativa) só extrai o texto corrido
// — sem colunas/delimitador confiável — então a extração de linhas em si vira
// mais uma pergunta pra IA em vez da heurística de CSV. ────────────────────
async function extractRowsFromPdf(buffer: ArrayBuffer): Promise<ExtractedRow[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  if (!text.trim()) return []

  const system = `Você extrai itens de um picklist de marketplace (Shopee/Mercado Livre/UpSeller) a partir do texto cru de um PDF exportado, com várias páginas concatenadas — sem colunas confiáveis, o layout pode ter quebrado.

Formato comum (ex: relatório "Lista de Resumo" do UpSeller): tabela com colunas Anúncios (nome do produto) | Variação (cor/tamanho, ex: "Camiseta Rosa,TAM. 4" ou "KIT Bordo,TAM.12" ou só "Preto,G") | SKU do Anúncio | Qtd.

Cuidados:
- Cada página repete o cabeçalho da tabela ("Anúncios Variação SKU do Anúncio Qtd." ou parecido) e um rodapé (data, URL, número de página tipo "1/3") — ignore essas repetições, não são itens.
- Ignore também qualquer bloco de resumo do topo (ex: "Qtd. de pedidos", "Total de itens").
- Uma linha da tabela pode quebrar entre o fim de uma página e o início da próxima — o SKU ou outro campo pode terminar cortado numa página e sobrar um pedaço solto logo depois do cabeçalho repetido da próxima. Quando isso acontecer, junte o pedaço solto na linha anterior (mesmo item) em vez de tratar como linha nova ou perder informação.
- O nome do anúncio às vezes vem cortado com "…" no meio — tudo bem, extraia o que tiver, não é o campo mais importante.

Pra cada item de picklist que aparecer, extraia: sku, título (nome do anúncio), variacao (cor/tamanho como aparece no picklist — pode ser vazio se não existir campo separado), qty.

Responda APENAS um JSON: {"rows":[{"sku":"<sku ou \\"\\">","title":"<nome do anúncio ou \\"\\">","variacao":"<cor/tamanho como veio, ou \\"\\">","qty":<inteiro>}]}`

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 6144,
    system,
    messages: [{ role: "user", content: text.slice(0, 20_000) }],
  })
  const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? ""
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { rows: { sku: string; title: string; variacao: string; qty: number }[] }
    return (parsed.rows ?? [])
      .filter(r => r.title || r.sku || r.variacao)
      .map(r => ({
        raw: `${r.sku ? r.sku + " — " : ""}${r.variacao || r.title}`,
        sku: r.sku ?? "", title: r.title ?? "", variacao: r.variacao ?? "", qty: Math.max(1, r.qty || 1),
      }))
  } catch {
    return []
  }
}

function buildUnresolved(r: ExtractedRow, hint: RowHint): ReviewRow {
  const suffix = hint?.kind === "single" ? ` (pista: ${hint.productName})` : ""
  return {
    raw: r.raw, title: r.title + suffix, variacao: r.variacao, marketplaceSku: r.sku, variantId: null, productName: null, color: null, size: null,
    categoryName: null, sku: r.sku || null, stock: null, qty: r.qty, source: null, unresolved: true, isKit: false, qtyPerKit: 1, timesUsed: null,
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? ""
    let filename = "lista colada"
    let extracted: ExtractedRow[] = []

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file") as File | null
      const pasted = form.get("text") as string | null

      if (file) {
        filename = file.name
        if (/\.pdf$/i.test(file.name)) {
          extracted = await extractRowsFromPdf(await file.arrayBuffer())
        } else if (/\.(csv|txt)$/i.test(file.name)) {
          extracted = extractRows(await file.text())
        } else {
          return NextResponse.json({ error: "Formato não suportado — envia CSV, TXT ou PDF." }, { status: 400 })
        }
      } else if (pasted?.trim()) {
        extracted = extractRows(pasted)
      }
    } else {
      const body = await req.json().catch(() => ({}))
      const text = (body?.text as string) ?? ""
      if (text.trim()) extracted = extractRows(text)
    }

    if (extracted.length === 0) {
      return NextResponse.json({ error: "Não consegui identificar linhas nesse arquivo" }, { status: 400 })
    }

    const [{ rows: catalogRaw }, { rows: assocRaw }, { rows: assocItemsRaw }, { rows: memoryRaw }] = await Promise.all([
      pool.query(`
        SELECT pv.id AS "variantId", pv.product_id AS "productId", p.name AS "productName",
               COALESCE(c.name, 'Outros') AS "categoryName",
               pv.color, pv.size, pv.sku,
               GREATEST(0, COALESCE(bal.qty,0) - COALESCE(locked.locked_qty,0))::int AS "availableStock"
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN (
          SELECT variant_id, SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END) qty
          FROM stock_movements GROUP BY variant_id
        ) bal ON bal.variant_id = pv.id
        LEFT JOIN (
          SELECT oi.variant_id, SUM(oi.qty) AS locked_qty
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.status IN ('triagem','em_separacao','pronto') AND oi.variant_id IS NOT NULL
          GROUP BY oi.variant_id
        ) locked ON locked.variant_id = pv.id
        WHERE pv.status = 'active' AND p.status = 'active'
      `),
      pool.query(`
        SELECT a.id, a.prefix, a.kind, a.product_id AS "productId", p.name AS "productName"
        FROM marketplace_sku_associations a
        LEFT JOIN products p ON p.id = a.product_id
      `),
      pool.query(`
        SELECT i.association_id AS "associationId", i.product_id AS "productId", i.qty, p.name AS "productName"
        FROM marketplace_sku_association_items i
        JOIN products p ON p.id = i.product_id
      `),
      pool.query(`
        SELECT m.id AS "matchId", m.match_key AS "matchKey", m.is_kit AS "isKit", m.times_used AS "timesUsed",
               mi.variant_id AS "variantId", mi.product_id AS "productId", mi.qty_per_kit AS "qtyPerKit"
        FROM marketplace_sku_matches m
        JOIN marketplace_sku_match_items mi ON mi.match_id = m.id
      `),
    ])
    const catalog = catalogRaw as CatalogVariant[]
    const itemsByAssoc = new Map<number, AssociationItem[]>()
    for (const it of assocItemsRaw as { associationId: number; productId: string; productName: string; qty: number }[]) {
      if (!itemsByAssoc.has(it.associationId)) itemsByAssoc.set(it.associationId, [])
      itemsByAssoc.get(it.associationId)!.push({ productId: it.productId, productName: it.productName, qty: it.qty })
    }
    const associations: Association[] = (assocRaw as { id: number; prefix: string; kind: "single" | "kit"; productId: string | null; productName: string | null }[])
      .map(a => ({ prefix: a.prefix, kind: a.kind, productId: a.productId, productName: a.productName, items: itemsByAssoc.get(a.id) ?? [] }))

    // Memória de SKU exato primeiro — só cai pra IA o que nunca foi visto (ou
    // cuja memória foi invalidada por variante/produto que saiu do catálogo).
    const memoryByKey = buildMemoryMap(memoryRaw as MemoryRaw[], catalog)
    const memoryRows: ReviewRow[] = []
    const aiExtracted: ExtractedRow[] = []
    for (const r of extracted) {
      const mem = r.sku.trim() ? memoryByKey.get(buildMatchKey(r.sku, r.variacao)) : undefined
      if (!mem) { aiExtracted.push(r); continue }
      for (const it of mem.items) {
        const variant = catalog.find(c => c.variantId === it.variantId)
        if (!variant) continue // segurança extra — buildMemoryMap já valida, não deveria cair aqui
        memoryRows.push({
          raw: r.raw, title: r.title, variacao: r.variacao, marketplaceSku: r.sku, variantId: variant.variantId,
          productName: variant.productName, color: variant.color, size: variant.size, sku: variant.sku, categoryName: variant.categoryName,
          stock: variant.availableStock, qty: r.qty * it.qtyPerKit, source: "memoria", unresolved: false,
          isKit: mem.isKit, qtyPerKit: it.qtyPerKit, timesUsed: mem.timesUsed,
        })
      }
    }

    const aiHints = aiExtracted.map(r => findHint(r, associations))
    const aiRows = await matchAllRows(aiExtracted, aiHints, catalog)
      .catch(() => aiExtracted.map((r, i) => buildUnresolved(r, aiHints[i])))

    const finalRows = [...memoryRows, ...aiRows]

    return NextResponse.json({
      filename,
      totalRows: finalRows.length,
      matchedByMemory: memoryRows.length,
      matchedByRule: finalRows.filter(r => r.source === "regra").length,
      matchedByAI: finalRows.filter(r => r.source === "ia").length,
      unresolved: finalRows.filter(r => r.unresolved).length,
      rows: finalRows,
      catalog, // pro front popular os selects de resolução manual
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/marketplace/parse:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
