import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getDocumentProxy, extractText } from "unpdf"
import { pool } from "@/lib/db"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}
type AssociationItem = { variantId: string; qty: number }
type Association = {
  prefix: string; kind: "single" | "kit"
  productId: string | null; color: string | null
  items: AssociationItem[]
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

// ── Fase 2: casamento por prefixo já conhecido (regra salva). Kit expande 1
// linha do picklist em N linhas de conferência — uma por peça do combo, com
// a quantidade já multiplicada (qty do picklist × qty daquela peça no kit). ──
function matchByPrefix(row: ExtractedRow, associations: Association[], catalog: CatalogVariant[]): ReviewRow[] | null {
  if (!row.sku) return null
  const skuUpper = row.sku.toUpperCase()
  const hit = associations
    .filter(a => skuUpper.startsWith(a.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] // prefixo mais específico primeiro
  if (!hit) return null

  if (hit.kind === "kit") {
    const rows = hit.items
      .map(it => catalog.find(c => c.variantId === it.variantId) ? { comp: it, variant: catalog.find(c => c.variantId === it.variantId)! } : null)
      .filter((x): x is { comp: AssociationItem; variant: CatalogVariant } => !!x)
      .map(({ comp, variant }) => ({
        raw: row.raw, title: row.title, marketplaceSku: row.sku, variantId: variant.variantId,
        productName: variant.productName, color: variant.color, size: variant.size, sku: variant.sku,
        stock: variant.availableStock, qty: row.qty * comp.qty, source: "regra" as const, unresolved: false,
      }))
    return rows.length > 0 ? rows : null
  }

  const variantsOfProduct = catalog.filter(c => c.productId === hit.productId && c.color === hit.color)
  const remainder = skuUpper.replace(hit.prefix, "").replace(/^[-_ ]+/, "")
  const bySkuSuffix = variantsOfProduct.find(v => remainder && remainder.startsWith(v.size.toUpperCase()))
  const byTitle = variantsOfProduct.find(v => new RegExp(`\\b${v.size}\\b`, "i").test(row.title))
  const variant = bySkuSuffix ?? byTitle

  if (!variant) return null // produto/cor reconhecido mas tamanho não bateu — cai pra revisão manual
  return [{
    raw: row.raw, title: row.title, marketplaceSku: row.sku, variantId: variant.variantId, productName: variant.productName,
    color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock,
    qty: row.qty, source: "regra", unresolved: false,
  }]
}

// ── Fase 3: linhas que sobraram vão pra IA analisar o título, numa chamada só ──
async function matchByAI(rows: ExtractedRow[], catalog: CatalogVariant[]): Promise<ReviewRow[]> {
  if (rows.length === 0) return []

  const catalogCompact = catalog.map(c => `${c.variantId}|${c.productName}|${c.color}|${c.size}`).join("\n")
  const rowsCompact = rows.map((r, i) => `${i}) SKU:"${r.sku}" TÍTULO:"${r.title}"`).join("\n")

  const system = `Você casa itens de um picklist de marketplace (Shopee/Mercado Livre) com o catálogo interno de uma confecção.

Catálogo (variantId|produto|cor|tamanho), um por linha:
${catalogCompact}

Pra cada linha do picklist abaixo, ache a variante do catálogo que melhor bate com o SKU e/ou título (nome do produto, cor, tamanho). Se não tiver certeza razoável, retorne variantId null — não é permitido chutar.

Responda APENAS um JSON: {"matches":[{"index":0,"variantId":"<uuid ou null>"}]}`

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: rowsCompact }],
  })
  const raw = res.content[0].type === "text" ? res.content[0].text : ""
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return rows.map(r => unresolvedRow(r))

  let matches: { index: number; variantId: string | null }[] = []
  try {
    matches = (JSON.parse(jsonMatch[0]) as { matches: typeof matches }).matches ?? []
  } catch {
    return rows.map(r => unresolvedRow(r))
  }

  return rows.map((r, i) => {
    const m = matches.find(x => x.index === i)
    const variant = m?.variantId ? catalog.find(c => c.variantId === m.variantId) : null
    if (!variant) return unresolvedRow(r)
    return {
      raw: r.raw, title: r.title, marketplaceSku: r.sku, variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock,
      qty: r.qty, source: "ia", unresolved: false,
    }
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

function unresolvedRow(r: ExtractedRow): ReviewRow {
  return {
    raw: r.raw, title: r.title, marketplaceSku: r.sku, variantId: null, productName: null, color: null, size: null,
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
        SELECT a.id, a.prefix, a.kind, a.product_id AS "productId", a.color
        FROM marketplace_sku_associations a
      `),
      pool.query(`
        SELECT association_id AS "associationId", variant_id AS "variantId", qty
        FROM marketplace_sku_association_items
      `),
    ])
    const catalog = catalogRaw as CatalogVariant[]
    const itemsByAssoc = new Map<number, AssociationItem[]>()
    for (const it of assocItemsRaw as { associationId: number; variantId: string; qty: number }[]) {
      if (!itemsByAssoc.has(it.associationId)) itemsByAssoc.set(it.associationId, [])
      itemsByAssoc.get(it.associationId)!.push({ variantId: it.variantId, qty: it.qty })
    }
    const associations: Association[] = (assocRaw as { id: number; prefix: string; kind: "single" | "kit"; productId: string | null; color: string | null }[])
      .map(a => ({ prefix: a.prefix, kind: a.kind, productId: a.productId, color: a.color, items: itemsByAssoc.get(a.id) ?? [] }))

    const byRule: (ReviewRow[] | null)[] = extracted.map(r => matchByPrefix(r, associations, catalog))
    const needAI = extracted.filter((_, i) => byRule[i] === null)
    const aiResults = await matchByAI(needAI, catalog).catch(() => needAI.map(unresolvedRow))

    let aiCursor = 0
    const finalRows: ReviewRow[] = byRule.flatMap(r => r ?? [aiResults[aiCursor++]])

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
