import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

const VALID_STATUSES = ["triagem", "confirmando", "em_separacao", "pronto", "cancelado"]

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const { status, actor, note, notifyClient, cancelMessage } = await req.json()

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Status inválido. Use: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      )
    }

    await client.query("BEGIN")

    const orderRes = await client.query(`
      SELECT o.id, o.number, o.contact_id, o.total_value,
             c.jid
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])

    if (!orderRes.rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const order = orderRes.rows[0]

    if (status === "pronto") {
      // Baixa estoque para cada item com variante vinculada
      const itemsRes = await client.query(`
        SELECT variant_id, qty, product_name
        FROM order_items
        WHERE order_id = $1 AND variant_id IS NOT NULL
      `, [id])

      for (const item of itemsRes.rows) {
        await client.query(`
          INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
          VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)
        `, [item.variant_id, item.qty, `Pedido ${order.number}`])
      }

      // Atualiza lifecycle do contato
      await client.query(`
        UPDATE wa_contacts
        SET last_order_at        = NOW(),
            lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [order.contact_id])

      await client.query(`
        UPDATE orders SET status = $1, completed_at = NOW() WHERE id = $2
      `, [status, id])
    } else {
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])
    }

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, $2, $3, $4)
    `, [id, status, actor ?? "dashboard", note ?? null])

    await client.query("COMMIT")

    // Envia lista de confirmação ao cliente e sincroniza state do contato
    if (status === "confirmando" && order.jid) {
      const { rows: itemRows } = await pool.query(`
        SELECT product_name, color, size, qty
        FROM order_items WHERE order_id = $1 ORDER BY id
      `, [id])
      const lines = itemRows.map((it: { product_name: string; color: string; size: string; qty: number }, idx: number) => {
        const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
        return `${idx + 1}. ${desc} · *${it.qty} un*`
      })
      const confirmMsg = `Olá! Seu pedido *${order.number}* está na lista:\n\n${lines.join("\n")}\n\nConfirme respondendo *SIM* para ir para separação ou *NÃO* se precisar ajustar.`
      sendWhatsApp(order.jid, confirmMsg).catch(() => {})
      pool.query(
        `UPDATE wa_contacts SET state = 'confirmando', state_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]
      ).catch(() => {})
    }

    // Notifica cliente via WhatsApp quando pedido fica pronto
    if (status === "pronto" && order.jid) {
      const { rows: s } = await pool.query(`SELECT key, value FROM app_settings WHERE key = 'endereco_retirada'`)
      const endereco = s[0]?.value ?? "Av. Santa Cruz, 3088"
      sendWhatsApp(
        order.jid,
        `🎉 Seu pedido *${order.number}* está *pronto para retirada*!\n\n📍 ${endereco}`
      ).catch(() => {})
    }

    // Notifica cancelamento apenas se operador optou por notificar
    if (status === "cancelado" && notifyClient && order.jid) {
      const msg = (cancelMessage as string)?.trim()
        || `Seu pedido *${order.number}* foi cancelado. Qualquer dúvida é só chamar.`
      sendWhatsApp(order.jid, msg).catch(() => {})
    }

    return NextResponse.json({ success: true, status })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
