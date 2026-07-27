import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/clientes-a-receber/historico?from=&to=&contactId=&q=
// Lista os pagamentos já registrados em receivable_payments (quitação de prazo
// e parcelas) — venda à vista nunca passa por aqui, fica só no relatório de
// vendas normal (decisão do usuário: histórico é só prazo/parcelado).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from      = searchParams.get("from")
    const to        = searchParams.get("to")
    const contactId = searchParams.get("contactId")
    const q         = searchParams.get("q")?.trim()

    // DTF confirma pagamento pelo mesmo endpoint /pay tanto pra prazo real
    // quanto pra pedido comum que só foi pago depois (sem due_date) — histórico
    // é só prazo/parcelado, então filtra pelo due_date do pedido de origem, o
    // mesmo critério que já define "cobrança" na lista de pendentes.
    const conds: string[] = ["COALESCE(o.due_date, d.due_date) IS NOT NULL"]
    const params: (string | number)[] = []

    if (from) { params.push(from); conds.push(`pay.created_at::date >= $${params.length}`) }
    if (to)   { params.push(to);   conds.push(`pay.created_at::date <= $${params.length}`) }
    if (contactId) {
      params.push(Number(contactId))
      conds.push(`COALESCE(o.contact_id, d.contact_id) = $${params.length}`)
    }
    if (q) {
      params.push(`%${q}%`)
      conds.push(`(COALESCE(c.name, d.cliente) ILIKE $${params.length} OR c.phone ILIKE $${params.length})`)
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : ""

    const { rows } = await pool.query(`
      WITH pay AS (
        SELECT
          rp.id, rp.kind, rp.order_id, rp.amount::float AS amount,
          rp.method, rp.notes, rp.created_at,
          ROW_NUMBER() OVER (PARTITION BY rp.kind, rp.order_id ORDER BY rp.created_at) AS parcela_num,
          COUNT(*)     OVER (PARTITION BY rp.kind, rp.order_id)                        AS total_parcelas
        FROM receivable_payments rp
      )
      SELECT
        pay.id,
        pay.kind,
        pay.order_id                                AS "orderId",
        COALESCE(o.number, d.number)                AS "orderNumber",
        COALESCE(o.total_value, d.preco_cobrado)::float AS "orderTotal",
        COALESCE(o.contact_id, d.contact_id)        AS "contactId",
        COALESCE(c.name, d.cliente)                 AS "contactName",
        c.phone                                     AS "contactPhone",
        pay.amount,
        pay.method,
        pay.notes,
        pay.created_at                              AS "createdAt",
        pay.parcela_num                             AS "parcelaNum",
        pay.total_parcelas                          AS "totalParcelas"
      FROM pay
      LEFT JOIN orders      o ON pay.kind = 'produto' AND o.id = pay.order_id
      LEFT JOIN dtf_pedidos d ON pay.kind = 'dtf'      AND d.id = pay.order_id
      LEFT JOIN wa_contacts c ON c.id = COALESCE(o.contact_id, d.contact_id)
      ${where}
      ORDER BY pay.created_at DESC
    `, params)

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
