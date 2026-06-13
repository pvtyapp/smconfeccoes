import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { cleanDtfBlobsOnConclude } from "@/lib/blob-cleanup"

const VALID = ["triagem", "em_producao", "pronto", "concluido", "cancelado"]

const WA_MESSAGES: Record<string, (number: string, endereco: string, extra?: { metros?: number; valor?: number }) => string> = {
  em_producao: (n, _e, extra) => {
    let msg = `🖨️ Seu pedido DTF *${n}* está em produção!`
    if (extra?.metros) msg += `\n📐 Metragem: *${extra.metros.toFixed(2)} m*`
    if (extra?.valor)  msg += `\n💰 Valor: *R$ ${extra.valor.toFixed(2).replace(".", ",")}*`
    msg += `\n\nAvisaremos quando estiver pronto.`
    return msg
  },
  pronto:    (n, e) => `✅ Seu pedido DTF *${n}* está *pronto para retirada*!\n\n📍 ${e}`,
  cancelado: (n) => `❌ Seu pedido DTF *${n}* foi cancelado. Qualquer dúvida, entre em contato.`,
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json() as { status: string; metrosFinais?: number; precoCobrado?: number; notifyClient?: boolean; cancelMessage?: string }
    const { status, metrosFinais, precoCobrado, notifyClient, cancelMessage } = body

    if (!VALID.includes(status))
      return NextResponse.json({ error: `Status inválido. Use: ${VALID.join(", ")}` }, { status: 400 })

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, p.created_at AS pedido_created_at, c.jid
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const pedido = rows[0]

    // Save metros / valor when advancing to em_producao
    if (status === "em_producao" && (metrosFinais != null || precoCobrado != null)) {
      await client.query(`
        UPDATE dtf_pedidos
        SET status = $1,
            metros_finais  = COALESCE($2::numeric, metros_finais),
            preco_cobrado  = COALESCE($3::numeric, preco_cobrado)
        WHERE id = $4
      `, [status, metrosFinais ?? null, precoCobrado ?? null, id])
    } else {
      await client.query(`UPDATE dtf_pedidos SET status = $1 WHERE id = $2`, [status, id])
    }

    if (status === "pronto" && pedido.contact_id) {
      await client.query(`
        UPDATE wa_contacts
        SET last_order_at = NOW(), lifecycle_state = 'active',
            lifecycle_updated_at = NOW(), ausente_seq = 0
        WHERE id = $1
      `, [pedido.contact_id])
    }

    await client.query("COMMIT")

    // WA notification — cancelado only notifies when notifyClient !== false
    if (pedido.jid && WA_MESSAGES[status]) {
      if (status === "cancelado" && notifyClient === false) {
        // Silent cancel — do not notify
      } else {
        const { rows: s } = await pool.query(`SELECT value FROM app_settings WHERE key = 'endereco_retirada'`)
        const endereco = s[0]?.value ?? "Av. Santa Cruz, 3088"
        const extra = status === "em_producao"
          ? { metros: metrosFinais, valor: precoCobrado }
          : undefined
        const msg = (status === "cancelado" && cancelMessage?.trim())
          ? cancelMessage.trim()
          : WA_MESSAGES[status](pedido.number, endereco, extra)
        sendWhatsApp(pedido.jid, msg).catch(() => {})
      }
    }

    // Free DTF blobs when order is done (fire-and-forget, outside transaction)
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
