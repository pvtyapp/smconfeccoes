import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { rows } = await pool.query(`
      SELECT
        o.id, o.number, o.status, o.source,
        o.total_value    AS "totalValue",
        o.payment_method AS "paymentMethod",
        o.paid_at        AS "paidAt",
        o.due_date       AS "dueDate",
        o.created_at     AS "createdAt",
        COALESCE(c.nome_cadastro, c.name) AS "contactName",
        c.phone          AS "contactPhone",
        fn.id            AS "fiscalNoteId",
        fn.status        AS "fiscalNoteStatus",
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'productName', oi.product_name, 'color', oi.color, 'size', oi.size,
              'qty', oi.qty, 'unitPrice', oi.unit_price
            ) ORDER BY oi.id
          ) FILTER (WHERE oi.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT fn.id, fn.status FROM fiscal_note_orders fno
        JOIN fiscal_notes fn ON fn.id = fno.fiscal_note_id
        WHERE fno.order_id = o.id AND fn.status != 'rejeitada'
        ORDER BY fn.id DESC LIMIT 1
      ) fn ON true
      WHERE o.contact_id = $1
      GROUP BY o.id, c.nome_cadastro, c.name, c.phone, fn.id, fn.status
      ORDER BY o.created_at DESC
      LIMIT 100
    `, [session.contactId])

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
