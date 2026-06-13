import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    if (!from || !to)
      return NextResponse.json({ error: "from e to obrigatórios" }, { status: 400 })

    // Pedidos de produto concluídos
    const { rows: produto } = await pool.query(`
      SELECT
        o.id,
        o.number,
        'produto'          AS tipo,
        o.status,
        o.total_value      AS valor,
        o.due_date         AS "dueDate",
        o.paid_at          AS "paidAt",
        o.completed_at     AS "concludedAt",
        o.created_at       AS "createdAt",
        c.name             AS "contactName",
        c.phone            AS "contactPhone",
        COUNT(oi.id)       AS "itemCount",
        SUM(oi.qty)        AS "totalQty"
      FROM orders o
      LEFT JOIN wa_contacts c ON c.id = o.contact_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'concluido'
        AND DATE(o.completed_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
      GROUP BY o.id, c.id
      ORDER BY o.completed_at DESC
    `, [from, to])

    // Pedidos DTF concluídos
    const { rows: dtf } = await pool.query(`
      SELECT
        p.id,
        p.number,
        'dtf'              AS tipo,
        p.status,
        p.preco_cobrado    AS valor,
        p.due_date         AS "dueDate",
        NULL               AS "paidAt",
        COALESCE(p.concluded_at, p.created_at) AS "concludedAt",
        p.created_at       AS "createdAt",
        COALESCE(c.name, p.cliente) AS "contactName",
        c.phone            AS "contactPhone",
        p.metros_finais    AS "metrosFinais",
        p.metros           AS metros
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.status = 'concluido'
        AND DATE(COALESCE(p.concluded_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
      ORDER BY p.created_at DESC
    `, [from, to])

    return NextResponse.json({
      produto,
      dtf,
      total: produto.length + dtf.length,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
