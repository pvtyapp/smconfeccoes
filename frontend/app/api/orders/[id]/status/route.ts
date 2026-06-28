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
    const { status, actor, note, notifyClient, cancelMessage, changes } = await req.json()

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

    if (status === "em_separacao") {
      // Baixa estoque quando entra em separação (não mais no pronto)
      const itemsRes = await client.query(`
        SELECT variant_id, qty, product_name
        FROM order_items
        WHERE order_id = $1 AND variant_id IS NOT NULL
      `, [id])

      // Evita baixa dupla se já foi baixado (is_partial já baixou no chatbot auto-advance)
      const { rows: alreadyDeducted } = await client.query(`
        SELECT 1 FROM stock_movements
        WHERE channel = 'chatbot' AND notes = $1 LIMIT 1
      `, [`Pedido ${order.number}`])

      if (!alreadyDeducted.length) {
        for (const item of itemsRes.rows) {
          await client.query(`
            INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
            VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)
          `, [item.variant_id, item.qty, `Pedido ${order.number}`])
        }
      }

      await client.query(`
        UPDATE orders SET status = $1, needs_print = true WHERE id = $2
      `, [status, id])
    } else if (status === "pronto") {
      // Atualiza lifecycle do contato ao concluir
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

    // Avisa o cliente que entrou em separação
    if (status === "em_separacao" && order.jid) {
      sendWhatsApp(
        order.jid,
        `📦 Seu pedido *${order.number}* está em separação! Avisamos quando pronto para retirada.`
      ).catch(() => {})
    }

    // Atualização de estoque em separação → volta pra triagem com WA contextual
    if (status === "triagem" && Array.isArray(changes) && changes.length > 0 && order.jid) {
      const { rows: itemRows } = await pool.query(`
        SELECT product_name, color, size, qty::int AS qty
        FROM order_items WHERE order_id = $1 ORDER BY id
      `, [id])
      const lines = itemRows.map((it: { product_name: string; color: string; size: string; qty: number }, idx: number) => {
        const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
        return `${idx + 1}. ${desc} · *${it.qty} un*`
      })
      type Change = { productName: string; color: string | null; size: string | null; oldQty: number; newQty: number }
      function itemLabelT(c: Change) { return [c.productName, c.color, c.size].filter(Boolean).join(" ") }
      const zeroed  = (changes as Change[]).filter(c => c.newQty === 0)
      const reduced = (changes as Change[]).filter(c => c.newQty > 0 && c.newQty < c.oldQty)
      const total   = zeroed.length + reduced.length
      let intro: string
      if (total === 1 && zeroed.length === 1) {
        intro = `A *${itemLabelT(zeroed[0])}* estamos sem estoque, mas o restante do pedido ficou assim:\n\n`
      } else if (total === 1 && reduced.length === 1) {
        intro = `Olha, a *${itemLabelT(reduced[0])}* vou ter somente *${reduced[0].newQty}*, seu pedido atualizado ficou:\n\n`
      } else {
        const bullets = [
          ...zeroed.map(c  => `• *${itemLabelT(c)}*: sem estoque`),
          ...reduced.map(c => `• *${itemLabelT(c)}*: somente *${c.newQty}*`),
        ]
        intro = `Atenção, atualizamos alguns itens do pedido *${order.number}*:\n${bullets.join("\n")}\n\nSeu pedido ficou assim:\n\n`
      }
      const msg = `${intro}${lines.join("\n")}\n\nResponde *confirmar* quando estiver certo 👍`
      sendWhatsApp(order.jid, msg).catch(() => {})
      pool.query(
        `UPDATE wa_contacts SET state = 'triagem', state_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]
      ).catch(() => {})
    }

    // Envia lista de confirmação ao cliente e sincroniza state do contato
    if (status === "confirmando" && order.jid) {
      const { rows: itemRows } = await pool.query(`
        SELECT product_name, color, size, qty::int AS qty
        FROM order_items WHERE order_id = $1 ORDER BY id
      `, [id])
      const lines = itemRows.map((it: { product_name: string; color: string; size: string; qty: number }, idx: number) => {
        const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
        return `${idx + 1}. ${desc} · *${it.qty} un*`
      })

      type Change = { productName: string; color: string | null; size: string | null; oldQty: number; newQty: number }
      function itemLabel(c: Change) {
        return [c.productName, c.color, c.size].filter(Boolean).join(" ")
      }

      let intro = `Olá! Seu pedido *${order.number}* está na lista:\n\n`
      if (Array.isArray(changes) && changes.length > 0) {
        const zeroed  = (changes as Change[]).filter(c => c.newQty === 0)
        const reduced = (changes as Change[]).filter(c => c.newQty > 0 && c.newQty < c.oldQty)
        const total   = zeroed.length + reduced.length
        if (total === 1 && zeroed.length === 1) {
          intro = `A *${itemLabel(zeroed[0])}* estamos sem estoque, mas o restante do pedido ficou assim:\n\n`
        } else if (total === 1 && reduced.length === 1) {
          intro = `Olha, a *${itemLabel(reduced[0])}* vou ter somente *${reduced[0].newQty}*, seu pedido atualizado ficou:\n\n`
        } else {
          const bullets = [
            ...zeroed.map(c  => `• *${itemLabel(c)}*: sem estoque`),
            ...reduced.map(c => `• *${itemLabel(c)}*: somente *${c.newQty}*`),
          ]
          intro = `Atenção, atualizamos alguns itens do pedido *${order.number}*:\n${bullets.join("\n")}\n\nSeu pedido ficou assim:\n\n`
        }
      }

      const confirmMsg = `${intro}${lines.join("\n")}\n\nConfirme respondendo *SIM* para ir para separação ou *NÃO* se precisar ajustar.`
      sendWhatsApp(order.jid, confirmMsg).catch(() => {})
      pool.query(
        `UPDATE wa_contacts SET state = 'confirmando', state_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]
      ).catch(() => {})
    }

    // Notifica cliente quando pedido fica separado (pronto para retirada)
    if (status === "pronto" && order.jid) {
      const { rows: s } = await pool.query(
        `SELECT key, value FROM app_settings WHERE key IN ('pix_key', 'endereco_retirada')`
      )
      const cfg: Record<string, string> = {}
      for (const r of s) cfg[r.key] = r.value

      const valor = order.total_value
        ? `\n\n💰 Valor: *R$ ${Number(order.total_value).toFixed(2).replace(".", ",")}*`
        : ""
      const pix = cfg.pix_key ? `\n💳 Pix: \`${cfg.pix_key}\`` : ""
      const end = cfg.endereco_retirada ? `\n\n📍 ${cfg.endereco_retirada}` : ""

      sendWhatsApp(
        order.jid,
        `✅ Seu pedido *${order.number}* está separado e pronto para retirada!${valor}${pix}${end}`
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
