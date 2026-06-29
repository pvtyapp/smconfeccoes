import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { method, notes, notifyClient } = body as {
      method?: string; notes?: string; notifyClient?: boolean
    }

    const { rows } = await pool.query(`
      SELECT o.id, o.number, o.status, o.paid_at, o.total_value,
             COALESCE(c.phone_jid, c.jid) AS jid, c.name AS "contactName"
      FROM orders o
      LEFT JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])

    if (!rows[0]) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (rows[0].paid_at) return NextResponse.json({ success: true, skipped: true })

    const note = [
      "Pagamento confirmado manualmente",
      method ? `Forma: ${method}` : null,
      notes?.trim() || null,
    ].filter(Boolean).join(" · ")

    await pool.query(`
      UPDATE orders SET paid_at = NOW(), pix_confirmed = true WHERE id = $1
    `, [id])

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      SELECT id, status, 'dashboard', $2 FROM orders WHERE id = $1
    `, [id, note])

    if (notifyClient && rows[0].jid) {
      const nome = (rows[0].contactName as string)?.split(" ")[0] ?? ""
      const valor = rows[0].total_value
        ? ` de *R$ ${Number(rows[0].total_value).toFixed(2).replace(".", ",")}*`
        : ""
      sendWhatsApp(
        rows[0].jid,
        `Pagamento${valor} do pedido *${rows[0].number}* confirmado! Obrigado${nome ? `, ${nome}` : ""} 🙏`
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
