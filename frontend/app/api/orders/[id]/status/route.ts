import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

const VALID_STATUSES = ["triagem", "confirmando", "em_separacao", "pronto", "pago", "concluido", "cancelado"]

// Envia WA e salva direto no banco — não depende do fromMe callback
async function sendAndSave(contactId: number, jid: string, text: string): Promise<void> {
  try {
    const result = await sendWhatsApp(jid, text) as { key?: { id?: string } }
    const msgId = result?.key?.id ?? null
    await pool.query(
      `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
       VALUES ($1, $2, 'out', $3, NOW())
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
      [contactId, msgId, text]
    )
  } catch { /* Evolution down — swallow */ }
}

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
      SELECT o.id, o.number, o.contact_id, o.status AS "currentStatus",
             o.total_value, c.name AS "contactName",
             COALESCE(c.phone_jid, c.jid) AS jid
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])

    if (!orderRes.rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const order = orderRes.rows[0] as {
      id: number; number: string; contact_id: number; currentStatus: string
      total_value: string | null; contactName: string | null; jid: string | null
    }

    // ── Lógica de cada stage ──────────────────────────────────────────────────

    if (status === "em_separacao") {
      // Deduz estoque (anti-duplicata)
      const itemsRes = await client.query(`
        SELECT variant_id, qty FROM order_items
        WHERE order_id = $1 AND variant_id IS NOT NULL
      `, [id])
      const { rows: alreadyDeducted } = await client.query(
        `SELECT 1 FROM stock_movements WHERE notes = $1 AND type = 'out' LIMIT 1`,
        [`Pedido ${order.number}`]
      )
      if (!alreadyDeducted.length) {
        for (const item of itemsRes.rows) {
          await client.query(`
            INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
            VALUES ($1, 'out', $2, 'venda', 'dashboard', $3)
          `, [item.variant_id, item.qty, `Pedido ${order.number}`])
        }
      }
      await client.query(
        `UPDATE orders SET status = $1, needs_print = true WHERE id = $2`,
        [status, id]
      )

    } else if (status === "pronto") {
      // Pronto para retirada — sem mudança de DB especial
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])

    } else if (status === "pago") {
      // Pagamento recebido pelo operador
      await client.query(
        `UPDATE orders SET status = $1, paid_at = NOW() WHERE id = $2`,
        [status, id]
      )

    } else if (status === "concluido") {
      // Entregue — fecha o ciclo
      await client.query(`
        UPDATE wa_contacts
        SET last_order_at        = NOW(),
            lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [order.contact_id])
      await client.query(
        `UPDATE orders SET status = $1, completed_at = NOW() WHERE id = $2`,
        [status, id]
      )

    } else if (status === "cancelado") {
      // Estorna estoque se já tinha saído (em_separacao, pronto, pago ou concluido)
      const needsReversal = ["em_separacao", "pronto", "pago", "concluido"].includes(order.currentStatus)
      if (needsReversal) {
        const { rows: alreadyReverted } = await client.query(
          `SELECT 1 FROM stock_movements WHERE notes = $1 AND type = 'in' LIMIT 1`,
          [`Estorno ${order.number}`]
        )
        if (!alreadyReverted.length) {
          const itemsRes = await client.query(`
            SELECT variant_id, qty FROM order_items
            WHERE order_id = $1 AND variant_id IS NOT NULL
          `, [id])
          for (const item of itemsRes.rows) {
            await client.query(`
              INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
              VALUES ($1, 'in', $2, 'estorno_cancelamento', 'dashboard', $3)
            `, [item.variant_id, item.qty, `Estorno ${order.number}`])
          }
        }
      }
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])

    } else {
      // triagem, confirmando — só atualiza status
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])
    }

    // ── Sincroniza state do chatbot ───────────────────────────────────────────
    const stateMap: Record<string, string> = {
      em_separacao: "em_separacao",
      pronto:       "pronto",
      pago:         "pago",
      concluido:    "idle",
      cancelado:    "idle",
    }
    if (stateMap[status]) {
      const activeStates = ["em_separacao", "pronto", "pago"]
      const newStateData = activeStates.includes(stateMap[status])
        ? JSON.stringify({ orderId: Number(id), orderNumber: order.number })
        : "{}"
      await client.query(
        `UPDATE wa_contacts SET state = $1, state_data = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [stateMap[status], newStateData, order.contact_id]
      )
    }

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, $2, $3, $4)
    `, [id, status, actor ?? "dashboard", note ?? null])

    await client.query("COMMIT")

    // ── Notificações WA pós-commit ────────────────────────────────────────────

    if (status === "em_separacao" && order.jid) {
      await sendAndSave(
        order.contact_id, order.jid,
        `📦 Seu pedido *${order.number}* está sendo separado! Avisamos quando estiver pronto para retirada.`
      )
    }

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

      await sendAndSave(
        order.contact_id, order.jid,
        `✅ Seu pedido *${order.number}* está pronto para retirada!${valor}${pix}${end}`
      )
    }

    if (status === "concluido" && order.jid) {
      const nome = order.contactName ? `, ${order.contactName.split(" ")[0]}` : ""
      await sendAndSave(
        order.contact_id, order.jid,
        `✅ Pedido *${order.number}* entregue! Obrigado${nome} pela preferência 🙏 Até a próxima!`
      )
      // Tags por produto (fire-and-forget)
      pool.query(`
        INSERT INTO wa_contact_tags (contact_id, tag, value)
        SELECT $1, 'comprou_produto', oi.product_name
        FROM order_items oi WHERE oi.order_id = $2
        ON CONFLICT DO NOTHING
      `, [order.contact_id, id]).catch(() => {})
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
      const zeroed  = (changes as Change[]).filter(c => c.newQty === 0)
      const reduced = (changes as Change[]).filter(c => c.newQty > 0 && c.newQty < c.oldQty)
      const total   = zeroed.length + reduced.length
      function itemLabelT(c: Change) { return [c.productName, c.color, c.size].filter(Boolean).join(" ") }
      let intro: string
      if (total === 1 && zeroed.length === 1) {
        intro = `A *${itemLabelT(zeroed[0])}* estamos sem estoque, mas o restante ficou assim:\n\n`
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
      await sendAndSave(order.contact_id, order.jid, msg)
      pool.query(
        `UPDATE wa_contacts SET state = 'triagem', state_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]
      ).catch(() => {})
    }

    // Lista de confirmação ao cliente
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
      function itemLabel(c: Change) { return [c.productName, c.color, c.size].filter(Boolean).join(" ") }
      let intro = `Olá! Seu pedido *${order.number}* está na lista:\n\n`
      if (Array.isArray(changes) && changes.length > 0) {
        const zeroed  = (changes as Change[]).filter(c => c.newQty === 0)
        const reduced = (changes as Change[]).filter(c => c.newQty > 0 && c.newQty < c.oldQty)
        const total   = zeroed.length + reduced.length
        if (total === 1 && zeroed.length === 1) {
          intro = `A *${itemLabel(zeroed[0])}* estamos sem estoque, mas o restante ficou assim:\n\n`
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
      const confirmMsg = `${intro}${lines.join("\n")}\n\nEstamos conferindo tudo! Qualquer ajuste, avisamos aqui. 😊`
      await sendAndSave(order.contact_id, order.jid, confirmMsg)
      pool.query(
        `UPDATE wa_contacts SET state = 'confirmando', state_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ orderId: Number(id), orderNumber: order.number }), order.contact_id]
      ).catch(() => {})
    }

    if (status === "cancelado" && notifyClient && order.jid) {
      const msg = (cancelMessage as string)?.trim()
        || `Seu pedido *${order.number}* foi cancelado. Qualquer dúvida é só chamar.`
      await sendAndSave(order.contact_id, order.jid, msg)
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
