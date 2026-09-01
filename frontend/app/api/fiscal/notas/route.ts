import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const from   = searchParams.get("from")
    const to     = searchParams.get("to")
    const search = searchParams.get("search")

    const conditions: string[] = []
    const params: unknown[] = []

    if (status) { params.push(status); conditions.push(`fn.status = $${params.length}`) }
    if (from)   { params.push(from);   conditions.push(`fn.criado_em >= $${params.length}::date`) }
    if (to)     { params.push(to);     conditions.push(`fn.criado_em < $${params.length}::date + INTERVAL '1 day'`) }
    if (search) { params.push(`%${search}%`); conditions.push(`(COALESCE(c.nome_cadastro, c.name) ILIKE $${params.length} OR o.number ILIKE $${params.length})`) }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    // Uma nota pode cobrir vários pedidos (emissão consolidada) — todos
    // garantidamente do mesmo cliente, por isso MAX(contactName) é seguro
    // (mesmo valor em toda linha do grupo).
    const { rows } = await pool.query(`
      SELECT
        fn.id, fn.status, fn.numero, fn.serie, fn.chave_acesso AS "chaveAcesso",
        fn.motivo_rejeicao AS "motivoRejeicao", fn.valor_total AS "valorTotal",
        fn.ambiente, fn.criado_em AS "criadoEm", fn.autorizado_em AS "autorizadoEm",
        fn.enviado_email_em AS "enviadoEmailEm", fn.enviado_whatsapp_em AS "enviadoWhatsappEm",
        string_agg(o.number, ', ' ORDER BY o.number) AS "orderNumbers",
        MAX(COALESCE(c.nome_cadastro, c.name)) AS "contactName"
      FROM fiscal_notes fn
      JOIN fiscal_note_orders fno ON fno.fiscal_note_id = fn.id
      JOIN orders o ON o.id = fno.order_id
      JOIN wa_contacts c ON c.id = o.contact_id
      ${where}
      GROUP BY fn.id
      ORDER BY fn.criado_em DESC
      LIMIT 500
    `, params)

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
