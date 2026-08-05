import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

const VALID_STATUSES = ["triagem", "em_separacao", "pronto", "concluido", "cancelado"]

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const { status, actor, note, notifyClient, cancelMessage, dueDate, paid } = await req.json()

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Status inválido. Use: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      )
    }

    await client.query("BEGIN")
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_alert JSONB,
      ADD COLUMN IF NOT EXISTS alteration_sent BOOLEAN NOT NULL DEFAULT false
    `).catch(() => {})

    const orderRes = await client.query(`
      SELECT o.id, o.number, o.contact_id, o.status AS "currentStatus",
             o.total_value, c.name AS "contactName",
             c.jid AS jid
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
      // Kanban 3 estágios: entrar em Separação NÃO mexe mais em estoque nem no
      // pedido — só calcula um aviso informativo (stock_alert) pro operador ver
      // o que pode faltar. Qualquer alteração real é manual (editar item, que
      // dispara /alert-alteration) — nada aqui trunca quantidade sozinho.
      const itemsRes = await client.query(`
        SELECT variant_id, qty::int AS qty, product_name, color, size FROM order_items
        WHERE order_id = $1
      `, [id])
      const stockAlert: { productName: string; color: string; size: string; requested: number; available: number }[] = []
      for (const item of itemsRes.rows) {
        if (!item.variant_id) continue
        const { rows: balRows } = await client.query(
          `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS bal
           FROM stock_movements WHERE variant_id = $1`,
          [item.variant_id]
        )
        const available = Math.max(0, balRows[0].bal)
        if (available < item.qty) {
          stockAlert.push({
            productName: item.product_name, color: item.color, size: item.size,
            requested: item.qty, available,
          })
        }
      }
      await client.query(
        `UPDATE orders SET status = $1, stock_alert = $2, alteration_sent = false WHERE id = $3`,
        [status, stockAlert.length > 0 ? JSON.stringify(stockAlert) : null, id]
      )

    } else if (status === "pronto") {
      // Selo Pagou/Não pagou nasce marcado "Não pagou" — nunca fica em branco
      // pro operador ter que adivinhar o padrão.
      await client.query(
        `UPDATE orders SET status = $1, paid_label = COALESCE(paid_label, false) WHERE id = $2`,
        [status, id]
      )

    } else if (status === "concluido") {
      // Entregue — aqui (e só aqui) o estoque de fato sai do sistema. Anti-duplicata:
      // se esse pedido já debitou estoque num ciclo anterior (ex: pedido que já
      // estava em separação/pronto ANTES da migração pro Kanban de 3 estágios,
      // quando o corte ainda era automático na entrada de Separação), não debita
      // de novo — só fecha o ciclo.
      const { rows: alreadyDeducted } = await client.query(
        `SELECT 1 FROM stock_movements WHERE notes = $1 AND type = 'out' LIMIT 1`,
        [`Pedido ${order.number}`]
      )
      if (!alreadyDeducted.length) {
        const itemsRes = await client.query(`
          SELECT variant_id, qty::int AS qty FROM order_items
          WHERE order_id = $1 AND variant_id IS NOT NULL
        `, [id])
        for (const item of itemsRes.rows) {
          const { rows: balRows } = await client.query(
            `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS bal
             FROM stock_movements WHERE variant_id = $1`,
            [item.variant_id]
          )
          const toDeduct = Math.min(item.qty, Math.max(0, balRows[0].bal))
          if (toDeduct > 0) {
            await client.query(`
              INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
              VALUES ($1, 'out', $2, 'venda', 'dashboard', $3)
            `, [item.variant_id, toDeduct, `Pedido ${order.number}`])
          }
        }
      }

      await client.query(`
        UPDATE wa_contacts
        SET last_order_at        = NOW(),
            lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [order.contact_id])
      await client.query(
        `UPDATE orders SET status = $1, completed_at = NOW(), due_date = $3, paid_at = $4 WHERE id = $2`,
        [status, id, dueDate ?? null, paid ? new Date().toISOString() : null]
      )

    } else if (status === "cancelado") {
      // Estorna estoque só se já tinha saído — cobre principalmente pedidos que
      // já estavam em andamento ANTES da migração pro Kanban de 3 estágios
      // (regime antigo debitava na entrada de Separação). Sob o regime novo o
      // estoque só sai no Concluir Entrega, que é terminal e não cancela mais.
      const needsReversal = ["em_separacao", "pronto", "concluido"].includes(order.currentStatus)
      if (needsReversal) {
        const { rows: alreadyReverted } = await client.query(
          `SELECT 1 FROM stock_movements WHERE notes = $1 AND type = 'in' LIMIT 1`,
          [`Estorno ${order.number}`]
        )
        if (!alreadyReverted.length) {
          const itemsRes = await client.query(`
            SELECT variant_id, qty::int AS qty FROM order_items
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
      // triagem — só atualiza status
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])
    }

    // ── Sincroniza state do chatbot ───────────────────────────────────────────
    const stateMap: Record<string, string> = {
      em_separacao: "em_separacao",
      pronto:       "pronto",
      concluido:    "idle",
      cancelado:    "idle",
    }
    if (stateMap[status]) {
      const activeStates = ["em_separacao", "pronto"]
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
    // Em Separação fica silencioso na entrada — a mensagem só sai quando o
    // pedido vira Pronto (Concluir Separação).

    if (status === "pronto" && order.jid) {
      const { rows: s } = await pool.query(
        `SELECT key, value FROM app_settings WHERE key IN ('pix_key_pedidos', 'endereco_retirada')`
      )
      const cfg: Record<string, string> = {}
      for (const r of s) cfg[r.key] = r.value

      const { rows: totalRows } = await pool.query(
        `SELECT SUM(COALESCE(qty_confirmed, qty) * COALESCE(unit_price, 0)) AS total FROM order_items WHERE order_id = $1`,
        [id]
      )
      const total = Number(totalRows[0]?.total ?? 0)

      const valor = total > 0
        ? `\n\n💰 Valor: *R$ ${total.toFixed(2).replace(".", ",")}*`
        : ""
      const pix = cfg.pix_key_pedidos ? `\n💳 Pix: \`${cfg.pix_key_pedidos}\`` : ""
      const end = cfg.endereco_retirada ? `\n\n📍 ${cfg.endereco_retirada}` : ""

      await sendAndSave(
        order.contact_id, order.jid,
        `Seu pedido *${order.number}* está separado para retirada!${valor}${pix}${end}`
      )
    }

    if (status === "concluido" && order.jid) {
      const nome = order.contactName ? `, ${order.contactName.split(" ")[0]}` : ""
      const msg = dueDate
        ? (() => {
            const [y, m, d] = (dueDate as string).split("-")
            return `Obrigado${nome}! Seu pedido *${order.number}* foi retirado com pagamento até *${d}/${m}/${y}*. Qualquer dúvida é só chamar 😊`
          })()
        : `✅ Pedido *${order.number}* entregue! Obrigado${nome} pela preferência 🙏 Até a próxima!`
      await sendAndSave(order.contact_id, order.jid, msg)
      // Tags por produto (fire-and-forget)
      pool.query(`
        INSERT INTO wa_contact_tags (contact_id, tag, value)
        SELECT $1, 'comprou_produto', oi.product_name
        FROM order_items oi WHERE oi.order_id = $2
        ON CONFLICT DO NOTHING
      `, [order.contact_id, id]).catch(() => {})
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
