import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.jid,
        c.lifecycle_state        AS "lifecycleState",
        c.last_order_at          AS "lastOrderAt",
        c.payment_term_enabled   AS "paymentTermEnabled",
        c.payment_term_type      AS "paymentTermType",
        c.payment_term_days      AS "paymentTermDays",
        c.created_at             AS "createdAt",
        COUNT(o.id)
          FILTER (WHERE o.status != 'cancelado')           AS "orderCount",
        COALESCE(
          SUM(o.total_value)
          FILTER (WHERE o.status != 'cancelado'), 0
        )                                                  AS "totalSpent"
      FROM wa_contacts c
      LEFT JOIN orders o ON o.contact_id = c.id
      GROUP BY c.id
      ORDER BY c.last_order_at DESC NULLS LAST, c.created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
