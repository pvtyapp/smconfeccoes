import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// `variacao` é o texto cru da coluna Variação do picklist (ex: "Camiseta Rosa,TAM.
// 4", "KIT Bordo,TAM.12"). `cor`/`tamanho` são os dois pedaços já separados —
// só pra organizar a ficha impressa, nunca decidem nada contra um catálogo
// (essa página não casa mais com estoque, só lê e organiza pra imprimir).
type ExtractedRow = { raw: string; sku: string; title: string; variacao: string; cor: string; tamanho: string; qty: number }
type SourceSummary = { pedidos: number | null; totalItens: number | null } | null

function extractSourceSummary(text: string): SourceSummary {
  const pedidosMatch = text.match(/pedidos?\s*[:\-]?\s*(\d+)/i)
  const itensMatch = text.match(/total\s+de\s+itens\s*[:\-]?\s*(\d+)/i)
  const pedidos = pedidosMatch ? parseInt(pedidosMatch[1], 10) : null
  const totalItens = itensMatch ? parseInt(itensMatch[1], 10) : null
  if (pedidos === null && totalItens === null) return null
  return { pedidos, totalItens }
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

// Separa "Camiseta Rosa,TAM. 4" em cor="Camiseta Rosa" (fica como veio — sem
// catálogo pra normalizar) e tamanho="4" (tira o prefixo "TAM."). Best-effort:
// sem vírgula, tudo vira cor e o tamanho fica vazio — só afeta como a ficha
// organiza visualmente, nunca decide estoque.
function splitVariacao(variacao: string): { cor: string; tamanho: string } {
  if (!variacao) return { cor: "", tamanho: "" }
  const parts = variacao.split(",")
  if (parts.length < 2) return { cor: variacao.trim(), tamanho: "" }
  const cor = parts[0].trim()
  const tamanho = parts.slice(1).join(",").replace(/tam\.?\s*/i, "").trim()
  return { cor, tamanho }
}

function extractRows(text: string): ExtractedRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const delim = detectDelimiter(lines[0])
  const parsed = lines.map(l => splitCsvLine(l, delim))
  const width = Math.max(...parsed.map(r => r.length))
  if (width < 2) {
    return parsed.map(r => ({ raw: r[0], sku: "", title: r[0], variacao: "", cor: "", tamanho: "", qty: 1 }))
  }

  const firstLower = parsed[0].map(c => c.toLowerCase())
  let skuCol = firstLower.findIndex(c => HEADER_HINTS.sku.some(h => c.includes(h)))
  let titleCol = firstLower.findIndex(c => HEADER_HINTS.title.some(h => c.includes(h)))
  const variacaoCol = firstLower.findIndex(c => HEADER_HINTS.variacao.some(h => c.includes(h)))
  let qtyCol = firstLower.findIndex(c => HEADER_HINTS.qty.some(h => c.includes(h)))
  const hasHeader = skuCol >= 0 || titleCol >= 0 || variacaoCol >= 0 || qtyCol >= 0
  const dataRows = hasHeader ? parsed.slice(1) : parsed

  if (!hasHeader) {
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
      const { cor, tamanho } = splitVariacao(variacao.trim())
      return { raw: r.join(" " + delim + " "), sku: sku.trim(), title: title.trim(), variacao: variacao.trim(), cor, tamanho, qty }
    })
}

// ── PDF: manda o arquivo direto pro Claude como documento — testado com
// picklist real de produção: um export do UpSeller veio como PDF baseado em
// imagem (sem texto selecionável), documento direto cobre os dois casos sem
// precisar detectar qual é qual. A IA já devolve cor/tamanho separados (lê a
// tabela e já sabe interpretar "Camiseta Rosa,TAM. 4" melhor que um regex). ──
async function extractRowsFromPdf(buffer: ArrayBuffer): Promise<{ rows: ExtractedRow[]; sourceSummary: SourceSummary }> {
  const base64 = Buffer.from(buffer).toString("base64")

  const system = `Você extrai itens de um picklist de marketplace (Shopee/Mercado Livre/UpSeller) a partir de um PDF exportado, possivelmente com várias páginas. O PDF pode não ter texto selecionável (é uma imagem da tabela) — leia visualmente o conteúdo.

Formato comum (ex: relatório "Lista de Resumo" do UpSeller): tabela com colunas Anúncios (nome do produto) | Variação (cor/tamanho, ex: "Camiseta Rosa,TAM. 4" ou "KIT Bordo,TAM.12" ou só "Preto,G") | SKU do Anúncio | Qtd. O topo do relatório às vezes tem um resumo tipo "Qtd. de pedidos: N" e "Total de itens: N" — não são itens da tabela, mas ANOTE esses 2 números se existirem (campo resumoTopo).

Cuidados:
- Cada página repete o cabeçalho da tabela e um rodapé (data, URL, número de página) — ignore, não são itens.
- Uma linha da tabela pode aparecer dividida entre o fim de uma página e o início da próxima — junte como o mesmo item.
- O nome do anúncio às vezes vem cortado com "…" — tudo bem, extraia o que tiver.
- Pra cada item, além do texto cru da Variação, separe também COR e TAMANHO como campos próprios (ex: "Camiseta Rosa,TAM. 4" → cor "Camiseta Rosa", tamanho "4"; "KIT Bordo,TAM.12" → cor "KIT Bordo", tamanho "12"; "Preto,G" → cor "Preto", tamanho "G"). Se não der pra separar, cor = o texto inteiro e tamanho = "".

Pra cada item de picklist que aparecer, extraia: sku, título (nome do anúncio), variacao (texto cru), cor, tamanho, qty.

Responda APENAS um JSON: {"resumoTopo":{"pedidos":<inteiro ou null>,"totalItens":<inteiro ou null>},"rows":[{"sku":"","title":"","variacao":"","cor":"","tamanho":"","qty":1}]}`

  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    system,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: "Extraia os itens desse picklist conforme as instruções." },
      ],
    }],
  })
  const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? ""
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { rows: [], sourceSummary: null }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      resumoTopo?: { pedidos: number | null; totalItens: number | null }
      rows: { sku: string; title: string; variacao: string; cor: string; tamanho: string; qty: number }[]
    }
    const rows = (parsed.rows ?? [])
      .filter(r => r.title || r.sku || r.variacao)
      .map(r => ({
        raw: `${r.sku ? r.sku + " — " : ""}${r.variacao || r.title}`,
        sku: r.sku ?? "", title: r.title ?? "", variacao: r.variacao ?? "",
        cor: r.cor ?? "", tamanho: r.tamanho ?? "", qty: Math.max(1, r.qty || 1),
      }))
    const rt = parsed.resumoTopo
    const sourceSummary: SourceSummary = rt && (rt.pedidos != null || rt.totalItens != null)
      ? { pedidos: rt.pedidos ?? null, totalItens: rt.totalItens ?? null }
      : null
    return { rows, sourceSummary }
  } catch {
    return { rows: [], sourceSummary: null }
  }
}

// ── Agrupa em blocos por produto (título) — dentro de cada bloco, junta
// cor+tamanho repetidos somando a quantidade. Puramente organizacional, não
// decide nada contra estoque (essa página não casa mais com catálogo). ──────
type SeparationItem = { cor: string; tamanho: string; qty: number }
type SeparationBlock = { title: string; isKit: boolean; items: SeparationItem[] }

function buildBlocks(rows: ExtractedRow[]): SeparationBlock[] {
  const byTitle = new Map<string, ExtractedRow[]>()
  for (const r of rows) {
    const key = r.title.trim() || "(sem nome)"
    if (!byTitle.has(key)) byTitle.set(key, [])
    byTitle.get(key)!.push(r)
  }

  return [...byTitle.entries()].map(([title, group]) => {
    const byVariant = new Map<string, SeparationItem>()
    for (const r of group) {
      const key = `${r.cor.toLowerCase()}|${r.tamanho.toLowerCase()}`
      if (!byVariant.has(key)) byVariant.set(key, { cor: r.cor, tamanho: r.tamanho, qty: 0 })
      byVariant.get(key)!.qty += r.qty
    }
    const isKit = /\bkit\b/i.test(title) || group.some(r => /\bkit\b/i.test(r.cor))
    return { title, isKit, items: [...byVariant.values()] }
  }).sort((a, b) => b.items.reduce((s, i) => s + i.qty, 0) - a.items.reduce((s, i) => s + i.qty, 0))
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? ""
    let filename = "lista colada"
    let extracted: ExtractedRow[] = []
    let sourceSummary: SourceSummary = null

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file") as File | null
      const pasted = form.get("text") as string | null

      if (file) {
        filename = file.name
        if (/\.pdf$/i.test(file.name)) {
          const pdfResult = await extractRowsFromPdf(await file.arrayBuffer())
          extracted = pdfResult.rows
          sourceSummary = pdfResult.sourceSummary
        } else if (/\.(csv|txt)$/i.test(file.name)) {
          const text = await file.text()
          extracted = extractRows(text)
          sourceSummary = extractSourceSummary(text)
        } else {
          return NextResponse.json({ error: "Formato não suportado — envia CSV, TXT ou PDF." }, { status: 400 })
        }
      } else if (pasted?.trim()) {
        extracted = extractRows(pasted)
        sourceSummary = extractSourceSummary(pasted)
      }
    } else {
      const body = await req.json().catch(() => ({}))
      const text = (body?.text as string) ?? ""
      if (text.trim()) {
        extracted = extractRows(text)
        sourceSummary = extractSourceSummary(text)
      }
    }

    if (extracted.length === 0) {
      return NextResponse.json({ error: "Não consegui identificar linhas nesse arquivo" }, { status: 400 })
    }

    const blocks = buildBlocks(extracted)

    return NextResponse.json({
      filename,
      sourceSummary,
      totalLinhas: extracted.length,
      totalPecas: extracted.reduce((s, r) => s + r.qty, 0),
      blocks,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/marketplace/parse:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
