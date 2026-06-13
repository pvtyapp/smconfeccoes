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
    const { metrosFinais, precoCobrado, dueDate } = await req.json()

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, c.jid,
             c.payment_term_enabled AS "paymentTermEnabled"
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const pedido = rows[0]

    // If no price provided, calculate from DTF product sale_price × metros
    let resolvedPreco = precoCobrado ?? null
    if (!resolvedPreco && metrosFinais) {
      const prodRes = await client.query(`
        SELECT sale_price FROM products
        WHERE LOWER(name) LIKE 'dtf%' AND status = 'active'
        ORDER BY created_at ASC LIMIT 1
      `)
      if (prodRes.rows[0]) resolvedPreco = Number(metrosFinais) * Number(prodRes.rows[0].sale_price)
    }

    await client.query(`
      UPDATE dtf_pedidos
      SET status        = 'concluido',
          metros_finais = COALESCE($1, metros_finais),
          preco_cobrado = COALESCE($2, preco_cobrado),
          due_date      = $3,
          concluded_at  = NOW()
      WHERE id = $4
    `, [metrosFinais ?? null, resolvedPreco, dueDate ?? null, id])

    if (pedido.contact_id) {
      await client.query(`
        UPDATE wa_contacts
        SET last_order_at = NOW(), lifecycle_state = 'active',
            lifecycle_updated_at = NOW(), ausente_seq = 0
        WHERE id = $1
      `, [pedido.contact_id])
    }

    await client.query("COMMIT")

    // WA notification
    if (pedido.jid) {
      const { rows: s } = await pool.query(`SELECT key, value FROM app_settings WHERE key IN ('pix_key', 'endereco_retirada')`)
      const cfg: Record<string, string> = {}
      for (const r of s) cfg[r.key] = r.value

      const valorStr = precoCobrado ? `*R$ ${Number(precoCobrado).toFixed(2).replace(".", ",")}*` : "—"

      let msg: string
      if (dueDate) {
        const dueFmt = new Date(dueDate + "T12:00:00").toLocaleDateString("pt-BR")
        msg = `✅ Pedido DTF *${pedido.number}* concluído!\n\nValor: ${valorStr}\nVencimento: *${dueFmt}*\n\nObrigado!`
      } else {
        const pix = cfg.pix_key ? `\n\nPix: \`${cfg.pix_key}\`` : ""
        msg = `✅ Pedido DTF *${pedido.number}* concluído!\n\nValor: ${valorStr}${pix}\n\nObrigado!`
      }

      sendWhatsApp(pedido.jid, msg).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
