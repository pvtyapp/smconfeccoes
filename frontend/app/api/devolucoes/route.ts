import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { COLUNAS, SELECT_DEVOLUCAO, validarCampos } from "@/lib/devolucoes"

// Devoluções do marketplace. Mesma sessão do painel (o middleware barra sem login),
// então o robô chama de dentro do navegador logado, igual ao aviso-marketplace.

// GET /api/devolucoes?situacao=&loja=&q=  → lista sem as apagadas, mais recentes primeiro
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams
    const where = ["deleted_at IS NULL"]
    const args: unknown[] = []
    const situacao = p.get("situacao")?.trim()
    const loja = p.get("loja")?.trim()
    const q = p.get("q")?.trim()
    if (situacao) { args.push(situacao); where.push(`situacao = $${args.length}`) }
    if (loja) { args.push(loja.toUpperCase()); where.push(`loja = $${args.length}`) }
    if (q) {
      args.push(`%${q}%`)
      const i = args.length
      where.push(`(sku ILIKE $${i} OR produto ILIKE $${i} OR pedido ILIKE $${i} OR numero_devolucao ILIKE $${i} OR pedido_reservado ILIKE $${i})`)
    }
    const { rows } = await pool.query(
      `SELECT ${SELECT_DEVOLUCAO} FROM devolucoes WHERE ${where.join(" AND ")} ORDER BY data DESC, id DESC`, args)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// POST /api/devolucoes → cria. Se já existe (numeroDevolucao + sku), mesmo apagada, não cria:
// 200 {"ok":true,"duplicada":true,"id":...}. Sucesso: {"ok":true,"id":...}
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: "corpo JSON inválido" }, { status: 400 }) }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "corpo JSON inválido" }, { status: 400 })
  if (!body.sku || !String(body.sku).trim()) return NextResponse.json({ error: "sku é obrigatório" }, { status: 400 })
  if (!body.loja) return NextResponse.json({ error: "loja é obrigatória (MARI ou SAMUEL)" }, { status: 400 })

  const r = validarCampos(body)
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 })
  const v = r.valores
  if (!v.origem) v.origem = "manual"

  try {
    const numero = v.numeroDevolucao as string | null | undefined
    if (numero) {
      const { rows } = await pool.query(
        "SELECT id FROM devolucoes WHERE numero_devolucao = $1 AND sku = $2 LIMIT 1", [numero, v.sku])
      if (rows[0]) return NextResponse.json({ ok: true, duplicada: true, id: rows[0].id })
    }
    const campos = Object.keys(v)
    const { rows } = await pool.query(
      `INSERT INTO devolucoes (${campos.map(k => COLUNAS[k]).join(", ")})
       VALUES (${campos.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      campos.map(k => v[k]))
    return NextResponse.json({ ok: true, id: rows[0].id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // corrida entre duas chamadas iguais: o índice único segura, responde como duplicada
    if (msg.includes("devolucoes_numero_sku_unico")) {
      const { rows } = await pool.query(
        "SELECT id FROM devolucoes WHERE numero_devolucao = $1 AND sku = $2 LIMIT 1", [v.numeroDevolucao, v.sku])
      return NextResponse.json({ ok: true, duplicada: true, id: rows[0]?.id ?? null })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
