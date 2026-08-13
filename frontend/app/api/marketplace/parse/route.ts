import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { pool } from "@/lib/db"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}
type Association = { prefix: string; productId: string; productName: string; color: string }

type ExtractedRow = { raw: string; sku: string; title: string; qty: number }
type ReviewRow = {
  raw: string
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

// ── Fase 2: casamento por prefixo já conhecido (regra salva) ──────────────
function matchByPrefix(row: ExtractedRow, associations: Association[], catalog: CatalogVariant[]): ReviewRow | null {
  if (!row.sku) return null
  const skuUpper = row.sku.toUpperCase()
  const hit = associations
    .filter(a => skuUpper.startsWith(a.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] // prefixo mais específico primeiro
  if (!hit) return null

  const variantsOfProduct = catalog.filter(c => c.productId === hit.productId && c.color === hit.color)
  const remainder = skuUpper.replace(hit.prefix, "").replace(/^[-_ ]+/, "")
  const bySkuSuffix = variantsOfProduct.find(v => remainder && remainder.startsWith(v.size.toUpperCase()))
  const byTitle = variantsOfProduct.find(v => new RegExp(`\\b${v.size}\\b`, "i").test(row.title))
  const variant = bySkuSuffix ?? byTitle

  if (!variant) return null // produto/cor reconhecido mas tamanho não bateu — cai pra revisão manual
  return {
    raw: row.raw, marketplaceSku: row.sku, variantId: variant.variantId, productName: variant.productName,
    color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock,
    qty: row.qty, source: "regra", unresolved: false,
  }
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
      raw: r.raw, marketplaceSku: r.sku, variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock,
      qty: r.qty, source: "ia", unresolved: false,
    }
  })
}

function unresolvedRow(r: ExtractedRow): ReviewRow {
  return {
    raw: r.title || r.raw, marketplaceSku: r.sku, variantId: null, productName: null, color: null, size: null,
    sku: r.sku || null, stock: null, qty: r.qty, source: null, unresolved: true,
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? ""
    let text = ""
    let filename = "lista colada"

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file") as File | null
      const pasted = form.get("text") as string | null
      if (file) {
        if (!/\.(csv|txt)$/i.test(file.name)) {
          return NextResponse.json({ error: "Por enquanto só CSV ou TXT — exporta o picklist como CSV no marketplace." }, { status: 400 })
        }
        text = await file.text()
        filename = file.name
      } else if (pasted) {
        text = pasted
      }
    } else {
      const body = await req.json().catch(() => ({}))
      text = (body?.text as string) ?? ""
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "Nenhum conteúdo pra analisar" }, { status: 400 })
    }

    const extracted = extractRows(text)
    if (extracted.length === 0) {
      return NextResponse.json({ error: "Não consegui identificar linhas nesse arquivo" }, { status: 400 })
    }

    const [{ rows: catalogRaw }, { rows: assocRaw }] = await Promise.all([
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
        SELECT a.prefix, a.product_id AS "productId", p.name AS "productName", a.color
        FROM marketplace_sku_associations a
        JOIN products p ON p.id = a.product_id
      `),
    ])
    const catalog = catalogRaw as CatalogVariant[]
    const associations = assocRaw as Association[]

    const byRule: (ReviewRow | null)[] = extracted.map(r => matchByPrefix(r, associations, catalog))
    const needAI = extracted.filter((_, i) => byRule[i] === null)
    const aiResults = await matchByAI(needAI, catalog).catch(() => needAI.map(unresolvedRow))

    let aiCursor = 0
    const finalRows: ReviewRow[] = byRule.map(r => r ?? aiResults[aiCursor++])

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
