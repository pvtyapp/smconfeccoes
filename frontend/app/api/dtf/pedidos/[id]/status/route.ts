import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { cleanDtfBlobsOnConclude } from "@/lib/blob-cleanup"

const VALID = ["triagem", "em_producao", "pronto", "concluido", "cancelado"]

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json() as {
      status: string
      metrosFinais?: number
      precoCobrado?: number
      paymentMode?: "avista" | "prazo"
      dueDate?: string
      notifyClient?: boolean
      cancelMessage?: string
    }
    const { status, metrosFinais, precoCobrado, paymentMode, dueDate, notifyClient, cancelMessage } = body

    if (!VALID.includes(status))
      return NextResponse.json({ error: `Status inválido. Use: ${VALID.join(", ")}` }, { status: 400 })

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, p.created_at AS pedido_created_at,
             p.preco_cobrado AS preco_cobrado_db, c.jid
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const pedido = rows[0]

    if (status === "pronto") {
      // Save metros, preco and due_date; mark lifecycle active
      await client.query(`
        UPDATE dtf_pedidos
        SET status        = 'pronto',
            metros_finais = COALESCE($1::numeric, metros_finais),
            preco_cobrado = COALESCE($2::numeric, preco_cobrado),
            due_date      = $3
        WHERE id = $4
      `, [metrosFinais ?? null, precoCobrado ?? null, dueDate ?? null, id])

      if (pedido.contact_id) {
        await client.query(`
          UPDATE wa_contacts
          SET last_order_at = NOW(), lifecycle_state = 'active',
              lifecycle_updated_at = NOW(), ausente_seq = 0
          WHERE id = $1
        `, [pedido.contact_id])
      }

      await client.query("COMMIT")

      // WA: notify with valor + PIX or due date + address
      if (pedido.jid) {
        const { rows: s } = await pool.query(
          `SELECT key, value FROM app_settings WHERE key IN ('pix_key', 'endereco_retirada')`
        )
        const cfg: Record<string, string> = {}
        for (const r of s) cfg[r.key] = r.value

        // use body value or fall back to what's already in DB
        const valorFinal = precoCobrado ?? (pedido.preco_cobrado_db ? Number(pedido.preco_cobrado_db) : null)

        let msg = `✅ Pedido DTF *${pedido.number}* pronto para retirada!`

        if (valorFinal) {
          msg += `\n\n💰 Valor: *R$ ${valorFinal.toFixed(2).replace(".", ",")}*`
        }

        if (paymentMode === "prazo" && dueDate) {
          const dueFmt = new Date(dueDate + "T12:00:00").toLocaleDateString("pt-BR")
          msg += `\n📅 Vencimento: *${dueFmt}*`
        } else if (cfg.pix_key) {
          msg += `\n💳 Pix: \`${cfg.pix_key}\``
        }

        if (cfg.endereco_retirada) msg += `\n\n📍 ${cfg.endereco_retirada}`

        sendWhatsApp(pedido.jid, msg).catch(() => {})
      }

    } else if (status === "em_producao") {
      await client.query(`
        UPDATE dtf_pedidos
        SET status        = 'em_producao',
            metros_finais = COALESCE($1::numeric, metros_finais),
            preco_cobrado = COALESCE($2::numeric, preco_cobrado)
        WHERE id = $3
      `, [metrosFinais ?? null, precoCobrado ?? null, id])

      await client.query("COMMIT")

      if (pedido.jid) {
        let msg = `✅ Arte confirmada! Pedido *${pedido.number}* em produção.`
        if (metrosFinais) msg += `\n📐 Metragem: *${Number(metrosFinais).toFixed(2)} m*`
        if (precoCobrado) msg += `\n💰 Valor estimado: *R$ ${Number(precoCobrado).toFixed(2).replace(".", ",")}*`
        msg += `\n\nAvisamos quando estiver pronto!`
        sendWhatsApp(pedido.jid, msg).catch(() => {})
      }

    } else {
      await client.query(`UPDATE dtf_pedidos SET status = $1 WHERE id = $2`, [status, id])
      await client.query("COMMIT")

      // cancelado WA
      if (status === "cancelado" && pedido.jid && notifyClient !== false) {
        const msg = cancelMessage?.trim()
          || `❌ Seu pedido DTF *${pedido.number}* foi cancelado. Qualquer dúvida, entre em contato.`
        sendWhatsApp(pedido.jid, msg).catch(() => {})
      }
    }

    // Free DTF blobs when order is done (fire-and-forget)
    if ((status === "concluido" || status === "cancelado") && pedido.contact_id) {
      cleanDtfBlobsOnConclude(pedido.contact_id, new Date(pedido.pedido_created_at)).catch(() => {})
    }

    return NextResponse.json({ ok: true, status })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
