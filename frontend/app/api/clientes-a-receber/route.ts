import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        o.id,
        o.number,
        o.status,
        o.total_value  AS "totalValue",
        o.due_date     AS "dueDate",
        o.created_at   AS "createdAt",
        c.id           AS "contactId",
        c.name         AS "contactName",
        c.phone        AS "contactPhone",
        c.jid          AS "contactJid"
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
      ORDER BY o.due_date ASC NULLS LAST, c.name ASC, o.created_at ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
