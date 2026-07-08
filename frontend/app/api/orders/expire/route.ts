import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Called hourly via cron-job.org: POST /api/orders/expire
// Authorization: Bearer {CRON_SECRET}
export async function POST(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let expired   = 0
  let errors    = 0

  // ── Expire product orders stuck in triagem > 2h ────────────────────────────
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.contact_id
      FROM orders o
      WHERE o.status = 'triagem'
        AND o.created_at < NOW() - INTERVAL '2 hours'
    `)

    for (const row of rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        // A9: revert any stock_movements tied to this order before cancelling
        const { rows: mvRows } = await cli.query(`
          SELECT sm.id, sm.variant_id, sm.quantity
          FROM stock_movements sm
          JOIN orders o ON sm.notes = 'Pedido ' || o.number
          WHERE o.id = $1 AND sm.type = 'out'
        `, [row.id])
        for (const mv of mvRows) {
          await cli.query(`
            INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
            SELECT variant_id, 'in', quantity, 'estorno_expiracao', 'sistema',
                   'Estorno auto expiração - ' || notes
            FROM stock_movements WHERE id = $1
          `, [mv.id])
        }
        await cli.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [row.id])
        await cli.query(`
          INSERT INTO order_events (order_id, status, actor, note)
          VALUES ($1, 'cancelado', 'sistema', 'Expirado automaticamente após 2h em triagem')
        `, [row.id])
        await cli.query(`
          UPDATE wa_contacts
          SET state = 'idle', state_data = '{}', updated_at = NOW()
          WHERE id = $1
            AND state IN ('triagem','confirmando','cross_sell_dtf','cross_sell_produto','coletando')
        `, [row.contact_id])
        await cli.query("COMMIT")
        expired++
      } catch { await cli.query("ROLLBACK").catch(() => {}); errors++ }
      finally { cli.release() }
    }
  } catch { errors++ }

  return NextResponse.json({ ok: true, expired, errors })
}
