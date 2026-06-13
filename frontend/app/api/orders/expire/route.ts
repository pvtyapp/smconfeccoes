import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Called hourly via cron-job.org: POST /api/orders/expire
// Authorization: Bearer {CRON_SECRET}
export async function POST(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let expired = 0
  let errors  = 0

  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.contact_id
      FROM orders o
      WHERE o.status = 'triagem'
        AND o.created_at < NOW() - INTERVAL '2 hours'
    `)

    for (const row of rows) {
      try {
        await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [row.id])
        await pool.query(`
          INSERT INTO order_events (order_id, status, actor, note)
          VALUES ($1, 'cancelado', 'sistema', 'Expirado automaticamente após 2h em triagem')
        `, [row.id])
        await pool.query(`
          UPDATE wa_contacts
          SET state = 'idle', state_data = '{}', updated_at = NOW()
          WHERE id = $1
            AND state IN ('triagem','cross_sell_dtf','cross_sell_produto','coletando')
        `, [row.contact_id])
        expired++
      } catch { errors++ }
    }
  } catch { errors++ }

  return NextResponse.json({ ok: true, expired, errors })
}
