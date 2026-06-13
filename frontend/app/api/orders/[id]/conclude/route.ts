import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const { dueDate } = await req.json()

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT o.id, o.number, o.total_value, o.contact_id,
             c.jid, c.payment_term_enabled AS "paymentTermEnabled"
      FROM orders o
      LEFT JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const order = rows[0]
    const isPrazo = !!dueDate

    await client.query(`
      UPDATE orders
      SET status    = 'concluido',
          paid_at   = CASE WHEN $1 THEN NULL ELSE NOW() END,
          due_date  = $2,
          completed_at = NOW()
      WHERE id = $3
    `, [isPrazo, dueDate ?? null, id])

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'concluido', 'dashboard', $2)
    `, [id, isPrazo ? `Prazo — vence ${dueDate}` : "Pago e concluído"])

    await client.query("COMMIT")

    // Registra compra por produto + atualiza lifecycle (fire-and-forget, fora da tx)
    pool.query(
      `SELECT DISTINCT LOWER(product_name) AS pname FROM order_items WHERE order_id = $1`,
      [id]
    ).then(({ rows }) => {
      for (const r of rows) {
        pool.query(
          `INSERT INTO wa_contact_tags (contact_id, tag, value, source)
           VALUES ($1, 'comprou_produto', $2, 'chatbot')
           ON CONFLICT (contact_id, tag, value) DO NOTHING`,
          [order.contact_id, r.pname]
        ).catch(() => {})
      }
    }).catch(() => {})

    pool.query(
      `UPDATE wa_contacts
       SET last_order_at = NOW(), lifecycle_state = 'active',
           lifecycle_updated_at = NOW(), ausente_seq = 0
       WHERE id = $1`,
      [order.contact_id]
    ).catch(() => {})

    // WA notification
    if (order.jid) {
      const { rows: s } = await pool.query(`SELECT key, value FROM app_settings WHERE key IN ('pix_key', 'endereco_retirada')`)
      const cfg: Record<string, string> = {}
      for (const r of s) cfg[r.key] = r.value

      const valorStr = order.total_value
        ? `*R$ ${Number(order.total_value).toFixed(2).replace(".", ",")}*`
        : "—"

      let msg: string
      if (isPrazo) {
        const dueFmt = new Date(dueDate + "T12:00:00").toLocaleDateString("pt-BR")
        msg = `✅ Pedido *${order.number}* concluído!\n\nValor: ${valorStr}\nVencimento: *${dueFmt}*\n\nObrigado pela preferência!`
      } else {
        const pix = cfg.pix_key ? `\n\nPix: \`${cfg.pix_key}\`` : ""
        msg = `✅ Pedido *${order.number}* concluído!\n\nValor: ${valorStr}${pix}\n\nObrigado pela preferência!`
      }

      sendWhatsApp(order.jid, msg).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
