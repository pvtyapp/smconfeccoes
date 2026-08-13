import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getDocumentProxy, extractText } from "unpdf"
import { pool } from "@/lib/db"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}
type AssociationItem = { productId: string; productName: string; qty: number }
type Association = {
  prefix: string; kind: "single" | "kit"
  productId: string | null; productName: string | null // 'single'
  items: AssociationItem[] // 'kit'
}

type ExtractedRow = { raw: string; sku: string; title: string; qty: number }
type ReviewRow = {
  raw: string
  title: string // texto do anúncio/variação no picklist — mostrado junto do SKU pra facilitar conferência
  marketplaceSku: string // SKU original do picklist — sempre preservado, é ele que vira prefixo de associação
  variantId: string | null
  productName: string | null; color: string | null; size: string | null; sku: string | null
  stock: number | null
  qty: number
  source: "regra" | "ia" | null
  unresolved: boolean
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
  title: ["título", "titulo", "produto", "nome", "descrição", "descricao", "item"],
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
    return parsed.map(r => ({ raw: r[0], sku: "", title: r[0], qty: 1 }))
  }

  // Tenta achar cabeçalho na primeira linha
  const firstLower = parsed[0].map(c => c.toLowerCase())
  let skuCol = firstLower.findIndex(c => HEADER_HINTS.sku.some(h => c.includes(h)))
  let titleCol = firstLower.findIndex(c => HEADER_HINTS.title.some(h => c.includes(h)))
  let qtyCol = firstLower.findIndex(c => HEADER_HINTS.qty.some(h => c.includes(h)))
  const hasHeader = skuCol >= 0 || titleCol >= 0 || qtyCol >= 0
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
      const qtyRaw = qtyCol >= 0 ? (r[qtyCol] ?? "") : ""
      const qty = Math.max(1, parseInt(qtyRaw.replace(/\D/g, ""), 10) || 1)
      return { raw: r.join(" " + delim + " "), sku: sku.trim(), title: title.trim(), qty }
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
  const candidateLines = (productId: string) =>
    catalog.filter(c => c.productId === productId).map(c => `${c.variantId}|${c.color}|${c.size}`).join("\n")

  const catalogCompact = [...byProduct.entries()]
    .map(([name, vs]) => `## ${name}\n${vs.map(v => `${v.variantId}|${v.color}|${v.size}`).join("\n")}`)
    .join("\n\n")

  // Pra linha com pista, já entrega a lista de candidatos daquele produto
  // logo depois do título — reduz o catálogo a escanear de 150+ linhas pra
  // só as variantes daquele produto específico, bem menos chance de trocar.
  const rowsCompact = extracted.map((r, i) => {
    const hint = hints[i]
    const header = `${i}) SKU:"${r.sku}" TÍTULO:"${r.title}"`
    if (!hint) return `${header}\nPISTA_DO_CÓDIGO: (nenhuma — procure no catálogo completo acima)`
    if (hint.kind === "single") {
      return `${header}\nPISTA_DO_CÓDIGO: ${hint.productName}\nCandidatos (variantId|cor|tamanho) desse produto:\n${candidateLines(hint.productId)}`
    }
    const kitBlocks = hint.items.map((it, j) =>
      `  Peça ${j} — ${it.productName} (${it.qty}x):\n${candidateLines(it.productId).split("\n").map(l => "  " + l).join("\n")}`
    ).join("\n")
    return `${header}\nPISTA_DO_CÓDIGO: KIT com ${hint.items.length} peça(s)\n${kitBlocks}`
  }).join("\n\n")

  const system = `Você lê um picklist de marketplace (Shopee/Mercado Livre) de uma confecção e acha, pra cada item, a variante certa no catálogo interno — baseado no TÍTULO/variação (cor, tamanho), que é a informação mais confiável. O SKU sozinho quase nunca basta.

Catálogo completo, agrupado por produto (variantId|cor|tamanho):
${catalogCompact}

Cada item do picklist abaixo tem uma PISTA_DO_CÓDIGO (palpite pelo prefixo do SKU — pode estar errada ou não existir). Quando ela aponta um produto, junto vem a lista de "Candidatos" — as variantes REAIS daquele produto, já filtradas pra facilitar. Use como ajuda, nunca como verdade absoluta.

Regras:
- Leia o título com atenção — cor e tamanho têm que bater EXATAMENTE com um dos candidatos (ou do catálogo completo, se não tem pista). Preste atenção redobrada no tamanho: "8" é diferente de "6", "10" é diferente de "12" — não troque por um próximo.
- Se o título claramente indicar outro produto (diferente da pista), ignore a pista e procure no catálogo completo.
- Kit: cada peça é julgada separada. Se o título só dá informação suficiente pra ALGUMAS peças do kit (ex: só menciona 1 cor/tamanho pra um kit de 2 produtos diferentes), resolva as que der e devolva null pras que não tiverem informação própria no título — NÃO reaproveite a cor/tamanho de uma peça pra outra sem o título confirmar isso explicitamente pra cada uma.
- Só devolva um variantId quando tiver certeza (cor E tamanho reconhecidos de verdade no título). Sem certeza, devolva null. Não é permitido chutar.

Responda APENAS um JSON:
{"matches":[{"index":0,"picks":[{"variantId":"<uuid ou null>"}]}]}
(picks tem 1 item pra item normal, N itens pra kit — 1 por peça, na ordem da pista)`

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: rowsCompact }],
  })
  const raw = res.content[0].type === "text" ? res.content[0].text : ""
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
            raw: row.raw, title: row.title, marketplaceSku: row.sku, variantId: variant.variantId,
            productName: variant.productName, color: variant.color, size: variant.size, sku: variant.sku,
            stock: variant.availableStock, qty, source: "regra", unresolved: false,
          }
        }
        return {
          raw: row.raw, title: `${row.title} — peça do kit: ${comp.productName} (cor/tamanho não identificados)`,
          marketplaceSku: row.sku, variantId: null, productName: null, color: null, size: null, sku: row.sku || null,
          stock: null, qty, source: null, unresolved: true,
        }
      })
    }

    const pickedId = picks[0]?.variantId
    const variant = pickedId ? catalog.find(c => c.variantId === pickedId) : null
    if (!variant) return [buildUnresolved(row, hint)]
    return [{
      raw: row.raw, title: row.title, marketplaceSku: row.sku, variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock,
      qty: row.qty, source: hint ? "regra" : "ia", unresolved: false,
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

  const system = `Você extrai itens de um picklist de marketplace (Shopee/Mercado Livre) a partir do texto cru de um PDF exportado — sem colunas confiáveis, o layout pode ter quebrado.

Pra cada item de picklist que aparecer (produto + SKU e/ou quantidade), extraia uma linha. Ignore cabeçalho, rodapé, números de página e texto que não seja item de pedido.

Responda APENAS um JSON: {"rows":[{"sku":"<sku ou \\"\\">","title":"<título/descrição>","qty":<inteiro>}]}`

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: text.slice(0, 12_000) }],
  })
  const raw = res.content[0].type === "text" ? res.content[0].text : ""
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { rows: { sku: string; title: string; qty: number }[] }
    return (parsed.rows ?? [])
      .filter(r => r.title || r.sku)
      .map(r => ({ raw: `${r.sku ? r.sku + " — " : ""}${r.title}`, sku: r.sku ?? "", title: r.title ?? "", qty: Math.max(1, r.qty || 1) }))
  } catch {
    return []
  }
}

function buildUnresolved(r: ExtractedRow, hint: RowHint): ReviewRow {
  const suffix = hint?.kind === "single" ? ` (pista: ${hint.productName})` : ""
  return {
    raw: r.raw, title: r.title + suffix, marketplaceSku: r.sku, variantId: null, productName: null, color: null, size: null,
    sku: r.sku || null, stock: null, qty: r.qty, source: null, unresolved: true,
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

    const [{ rows: catalogRaw }, { rows: assocRaw }, { rows: assocItemsRaw }] = await Promise.all([
      pool.query(`
        SELECT pv.id AS "variantId", pv.product_id AS "productId", p.name AS "productName",
               pv.color, pv.size, pv.sku,
               GREATEST(0, COALESCE(bal.qty,0) - COALESCE(locked.locked_qty,0))::int AS "availableStock"
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
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
    ])
    const catalog = catalogRaw as CatalogVariant[]
    const itemsByAssoc = new Map<number, AssociationItem[]>()
    for (const it of assocItemsRaw as { associationId: number; productId: string; productName: string; qty: number }[]) {
      if (!itemsByAssoc.has(it.associationId)) itemsByAssoc.set(it.associationId, [])
      itemsByAssoc.get(it.associationId)!.push({ productId: it.productId, productName: it.productName, qty: it.qty })
    }
    const associations: Association[] = (assocRaw as { id: number; prefix: string; kind: "single" | "kit"; productId: string | null; productName: string | null }[])
      .map(a => ({ prefix: a.prefix, kind: a.kind, productId: a.productId, productName: a.productName, items: itemsByAssoc.get(a.id) ?? [] }))

    const hints = extracted.map(r => findHint(r, associations))
    const finalRows = await matchAllRows(extracted, hints, catalog)
      .catch(() => extracted.map((r, i) => buildUnresolved(r, hints[i])))

    return NextResponse.json({
      filename,
      totalRows: finalRows.length,
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
