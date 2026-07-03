import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const { items } = await req.json()

    await client.query("BEGIN")

    // Update confirmed quantities on each item
    if (Array.isArray(items)) {
      for (const item of items) {
        await client.query(
          "UPDATE order_items SET qty_confirmed = $1 WHERE id = $2 AND order_id = $3",
          [item.qtyConfirmed, item.id, id]
        )
      }
    }

    // Advance to em_separacao
    await client.query("UPDATE orders SET status = 'em_separacao' WHERE id = $1", [id])
    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'em_separacao', 'dashboard', 'Quantidades confirmadas — em separação')
    `, [id])

    // Sync chatbot state so cliente receives correct next message
    await client.query(`
      UPDATE wa_contacts SET state = 'em_separacao', state_data = $1, updated_at = NOW()
      WHERE id = (SELECT contact_id FROM orders WHERE id = $2)
        AND state IN ('triagem', 'confirmando', 'idle')
    `, [JSON.stringify({ orderId: Number(id) }), id])

    await client.query("COMMIT")
    return NextResponse.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
