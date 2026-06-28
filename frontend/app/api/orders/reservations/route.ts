import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/orders/reservations — lista reservas pendentes/notificadas
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        pr.id,
        pr.status,
        pr.qty,
        pr.notified_at  AS "notifiedAt",
        pr.expires_at   AS "expiresAt",
        pr.created_at   AS "createdAt",
        pr.order_id     AS "orderId",
        pv.color,
        pv.size,
        p.name          AS "productName",
        c.name          AS "contactName",
        c.phone         AS "contactPhone"
      FROM product_reservations pr
      JOIN product_variants pv ON pv.id = pr.variant_id
      JOIN products p          ON p.id  = pv.product_id
      JOIN wa_contacts c       ON c.id  = pr.contact_id
      WHERE pr.status IN ('pending', 'notified')
      ORDER BY pr.created_at ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
