import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

// POST /api/orders/[id]/request-confirmation
// Kanban 3 estágios: "confirmando" deixou de ser uma coluna própria — vira um
// sub-estado dentro de Triagem. Esta rota manda a lista de itens pro cliente
// confirmar via WhatsApp e marca confirmation_requested_at, SEM mudar o status
// (o pedido continua em triagem até o operador marcar "Cliente confirmou").
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_requested_at TIMESTAMPTZ
    `).catch(() => {})

    const { rows } = await pool.query(`
      SELECT o.id, o.number, o.contact_id, o.status, c.jid AS jid
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])
    const order = rows[0] as { id: number; number: string; contact_id: number; status: string; jid: string | null } | undefined
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (order.status !== "triagem") return NextResponse.json({ error: "Pedido não está em triagem" }, { status: 409 })
    if (!order.jid) return NextResponse.json({ error: "Contato sem WhatsApp vinculado" }, { status: 400 })

    const { rows: itemRows } = await pool.query(`
      SELECT product_name, color, size, qty::int AS qty
      FROM order_items WHERE order_id = $1 ORDER BY id
    `, [id])
    const lines = itemRows.map((it: { product_name: string; color: string; size: string; qty: number }, idx: number) => {
      const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
      return `${idx + 1}. ${desc} · *${it.qty} un*`
    })

    const msg = `Confirma por gentileza, será esses produtos mesmo?\n\n${lines.join("\n")}\n\nConfirmando já separo para você!`
    await sendAndSave(order.contact_id, order.jid, msg)

    await pool.query(`UPDATE orders SET confirmation_requested_at = NOW() WHERE id = $1`, [id])
    await pool.query(`
      UPDATE wa_contacts SET state = 'confirmando', state_data = $1, updated_at = NOW() WHERE id = $2
    `, [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]).catch(() => {})
    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'triagem', 'dashboard', 'Confirmação solicitada ao cliente')
    `, [id]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
