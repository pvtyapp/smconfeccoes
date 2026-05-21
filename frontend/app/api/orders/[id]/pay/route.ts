import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await pool.query(`
      UPDATE orders
      SET paid_at = NOW(), pix_confirmed = true
      WHERE id = $1 AND paid_at IS NULL
    `, [id])

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      SELECT id, status, 'dashboard', 'Pagamento confirmado manualmente'
      FROM orders WHERE id = $1
    `, [id])

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
