import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { classifyIntent } from "@/lib/ai/classifyIntent"
import { classifyMedia } from "@/lib/ai/classifyMedia"
import { downloadEvolutionMedia } from "@/lib/whatsapp/media"
import { uploadToBlob } from "@/lib/whatsapp/media"
import { matchVariants, type MatchedItem } from "@/lib/whatsapp/matchVariant"
import { sendWhatsApp } from "@/lib/whatsapp/send"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (body?.event !== "messages.upsert") return NextResponse.json({ ok: true })

    const msg = body?.data?.messages?.[0]
    if (!msg || msg.key?.fromMe) return NextResponse.json({ ok: true })

    const jid: string = msg.key?.remoteJid
    if (!jid || jid.endsWith("@g.us")) return NextResponse.json({ ok: true })

    const text: string =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ""

    const hasMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage)

    if (!text.trim() && !hasMedia) return NextResponse.json({ ok: true })

    const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    const pushName: string = msg.pushName || phone

    const contactRes = await pool.query(`
      INSERT INTO wa_contacts (jid, name, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (jid) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id, state, state_data AS "stateData", lifecycle_state AS "lifecycleState"
    `, [jid, pushName, phone])

    const contact = contactRes.rows[0]
    const state: string = contact.state ?? "idle"
    const stateData: Record<string, unknown> = contact.stateData ?? {}
    const lifecycle: string = contact.lifecycleState ?? "new"

    if (hasMedia) {
      await handleMedia(jid, contact.id, msg, text, lifecycle, state)
    } else {
      await handleText(jid, contact.id, state, stateData, text.trim(), lifecycle, pushName)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("WA webhook error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true }) // sempre 200 para Evolution não retentar
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function setState(contactId: number, state: string, data: Record<string, unknown> = {}) {
  await pool.query(
    "UPDATE wa_contacts SET state = $1, state_data = $2, updated_at = NOW() WHERE id = $3",
    [state, JSON.stringify(data), contactId]
  )
}

async function setLifecycleCurioso(contactId: number) {
  await pool.query(`
    UPDATE wa_contacts
    SET lifecycle_state      = 'curioso',
        lifecycle_updated_at = NOW(),
        curioso_started_at   = NOW(),
        curioso_seq          = 0
    WHERE id = $1
      AND lifecycle_state IN ('new', 'active')
  `, [contactId])
}

async function getMostRecentOrder(contactId: number) {
  const res = await pool.query(`
    SELECT id, number, status
    FROM orders
    WHERE contact_id = $1
      AND status NOT IN ('cancelado')
      AND paid_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [contactId])
  return res.rows[0] ?? null
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    triagem:      "em triagem",
    confirmando:  "confirmando quantidades",
    em_separacao: "em separação",
    pronto:       "pronto para retirada",
    cancelado:    "cancelado",
  }
  return map[status] ?? status
}

// ─── media ──────────────────────────────────────────────────────────────────

async function handleMedia(
  jid: string,
  contactId: number,
  msg: unknown,
  conversationContext: string,
  lifecycle: string,
  state: string
) {
  const media = await downloadEvolutionMedia(msg)
  if (!media) {
    await sendWhatsApp(jid, "Recebi seu arquivo, mas não consegui processar. Pode reenviar?")
    return
  }

  const context = conversationContext || state
  const mediaType = await classifyMedia(media.base64, media.mimeType, context)

  const order = await getMostRecentOrder(contactId)

  if (mediaType === "pix") {
    const url = await uploadToBlob(media.base64, media.mimeType, media.filename, "pix")

    if (order) {
      await pool.query(`
        INSERT INTO order_attachments (order_id, type, blob_url, filename, mime_type)
        VALUES ($1, 'pix_comprovante', $2, $3, $4)
      `, [order.id, url, media.filename, media.mimeType])

      await pool.query(`
        UPDATE orders SET has_attachment = true WHERE id = $1
      `, [order.id])

      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, $2, 'chatbot', 'Comprovante PIX recebido')
      `, [order.id, order.status])

      await sendWhatsApp(
        jid,
        `✅ Comprovante PIX recebido e vinculado ao pedido *${order.number}*!\n\nNossa equipe confirmará o pagamento em breve.`
      )
    } else {
      await sendWhatsApp(jid, "Comprovante PIX recebido! Quando seu pedido for registrado, vamos vincular.")
    }

  } else if (mediaType === "dtf") {
    const url = await uploadToBlob(media.base64, media.mimeType, media.filename, "dtf")

    if (order) {
      await pool.query(`
        INSERT INTO order_attachments (order_id, type, blob_url, filename, mime_type)
        VALUES ($1, 'dtf', $2, $3, $4)
      `, [order.id, url, media.filename, media.mimeType])

      await pool.query(`
        UPDATE orders SET has_attachment = true WHERE id = $1
      `, [order.id])

      await sendWhatsApp(jid, `📎 Arte DTF recebida para o pedido *${order.number}*! Disponível na triagem para download.`)
    } else {
      await sendWhatsApp(jid, "Arte DTF recebida! Quando o pedido for registrado, vincularemos o arquivo.")
    }

  } else {
    await sendWhatsApp(jid, "Recebi seu arquivo! Se for um comprovante de pagamento ou arte DTF, pode reenviar com uma mensagem explicando.")
  }
}

// ─── text ────────────────────────────────────────────────────────────────────

async function handleText(
  jid: string,
  contactId: number,
  state: string,
  stateData: Record<string, unknown>,
  text: string,
  lifecycle: string,
  pushName: string
) {
  const lower = text.toLowerCase().trim()

  if (lower === "cancelar" || lower === "cancel") {
    await setState(contactId, "idle")
    await sendWhatsApp(jid, "Tudo bem! Se precisar de algo é só chamar.")
    return
  }

  switch (state) {
    case "idle":
      await handleIdle(jid, contactId, text, lifecycle, pushName)
      break

    case "coletando":
      await handleColetando(jid, contactId, stateData, text)
      break

    case "aguardando_cliente_1":
      await handleAguardandoCliente1(jid, contactId, stateData, text)
      break

    default:
      // triagem / em_separacao / pronto — pedido ativo
      await handleActiveOrder(jid, contactId, text, pushName)
  }
}

async function handleIdle(
  jid: string,
  contactId: number,
  text: string,
  lifecycle: string,
  pushName: string
) {
  const intent = await classifyIntent(text)
  const firstName = pushName.split(" ")[0]

  switch (intent) {
    case "pedido":
      await setState(contactId, "coletando", { rawMessages: [text] })
      await tryParseAndConfirm(jid, contactId, [text])
      break

    case "preco":
      await setLifecycleCurioso(contactId)
      await sendWhatsApp(
        jid,
        `Oi ${firstName}! Para preços e disponibilidade, me diga qual produto quer saber — ou pode me chamar direto para fazer um pedido!`
      )
      break

    case "status": {
      const res = await pool.query(`
        SELECT number, status FROM orders
        WHERE contact_id = $1
        ORDER BY created_at DESC LIMIT 1
      `, [contactId])
      if (res.rows[0]) {
        await sendWhatsApp(jid, `Seu último pedido *${res.rows[0].number}* está: *${statusLabel(res.rows[0].status)}*`)
      } else {
        await sendWhatsApp(jid, "Não encontrei nenhum pedido seu. Quer fazer um?")
      }
      break
    }

    case "saudacao":
      await setState(contactId, "coletando", { rawMessages: [] })
      await sendWhatsApp(
        jid,
        `Oi ${firstName}! 👋 Bem-vindo à *SM Confecções*.\n\nMe diga quais produtos, cores e tamanhos você precisa.\n\nEx: _20 moletom preto P, 20 preto M, 10 cinza G_`
      )
      break

    default:
      await setState(contactId, "coletando", { rawMessages: [] })
      await sendWhatsApp(
        jid,
        `Olá, ${firstName}! Sou o atendimento da *SM Confecções*. Me diga o que você precisa!`
      )
  }
}

async function handleColetando(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const rawMessages = (stateData.rawMessages as string[] ?? []).concat(text)
  await setState(contactId, "coletando", { rawMessages })
  await tryParseAndConfirm(jid, contactId, rawMessages)
}

async function tryParseAndConfirm(jid: string, contactId: number, rawMessages: string[]) {
  const fullText = rawMessages.join("\n")

  let parsed
  try {
    parsed = await parseOrder(fullText)
  } catch {
    await sendWhatsApp(jid, "Pode continuar descrevendo o pedido. Me informe produtos, cores e tamanhos.")
    return
  }

  if (!parsed.length) {
    await sendWhatsApp(jid, "Ainda não identifiquei os itens. Ex: _20 moletom preto P_")
    return
  }

  const matched = await matchVariants(parsed)
  const hasUnmatched = matched.some(m => !m.matched)

  const lines = matched.map((m, idx) => {
    const desc = [m.productName, m.color, m.size].filter(Boolean).join(" ")
    const price = m.unitPrice ? ` · R$ ${(m.unitPrice * m.qty).toFixed(2)}` : ""
    const warn = m.matched ? "" : " ⚠️"
    return `${idx + 1}. ${desc} — *${m.qty} un*${price}${warn}`
  })

  let msg = `Entendi seu pedido:\n\n${lines.join("\n")}\n\n`
  if (hasUnmatched) msg += `⚠️ Itens marcados não foram localizados no catálogo. Nossa equipe verificará na triagem.\n\n`
  msg += `Está correto? Responda *SIM* para confirmar ou *NÃO* para ajustar.`

  await setState(contactId, "aguardando_cliente_1", { matched, rawMessages })
  await sendWhatsApp(jid, msg)
}

async function handleAguardandoCliente1(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower = text.toLowerCase().trim()

  if (["sim", "s", "yes"].includes(lower)) {
    const matched = stateData.matched as MatchedItem[]

    const numRes = await pool.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    const totalValue = matched.reduce((sum, m) => sum + (m.unitPrice ?? 0) * m.qty, 0)

    const orderRes = await pool.query(`
      INSERT INTO orders (number, contact_id, status, total_value)
      VALUES ($1, $2, 'triagem', $3)
      RETURNING id, number
    `, [number, contactId, totalValue > 0 ? totalValue : null])

    const orderId = orderRes.rows[0].id
    const orderNumber = orderRes.rows[0].number

    for (const item of matched) {
      await pool.query(`
        INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
    }

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'triagem', 'chatbot', 'Pedido confirmado pelo cliente via WhatsApp')
    `, [orderId])

    // Lifecycle: new/curioso → active; always refresh last_order_at
    await pool.query(`
      UPDATE wa_contacts
      SET lifecycle_state      = 'active',
          lifecycle_updated_at = NOW(),
          last_order_at        = NOW(),
          ausente_seq          = 0,
          curioso_seq          = 0
      WHERE id = $1
    `, [contactId])

    await setState(contactId, "triagem", { orderId, orderNumber })

    let reply = `✅ Pedido *${orderNumber}* recebido!`
    if (totalValue > 0) reply += `\nTotal estimado: *R$ ${totalValue.toFixed(2)}*`
    reply += `\n\nNossa equipe revisa e confirma em breve. Avisaremos quando estiver pronto!`

    await sendWhatsApp(jid, reply)

  } else if (["não", "nao", "n", "no"].includes(lower)) {
    await setState(contactId, "coletando", { rawMessages: [] })
    await sendWhatsApp(jid, "Tudo bem! Me diga novamente o que você precisa.")

  } else {
    await sendWhatsApp(jid, "Por favor, responda *SIM* para confirmar ou *NÃO* para ajustar o pedido.")
  }
}

async function handleActiveOrder(
  jid: string,
  contactId: number,
  text: string,
  pushName: string
) {
  const intent = await classifyIntent(text)

  if (intent === "pedido") {
    await setState(contactId, "coletando", { rawMessages: [text] })
    await tryParseAndConfirm(jid, contactId, [text])
    return
  }

  if (intent === "status") {
    const res = await pool.query(`
      SELECT number, status FROM orders
      WHERE contact_id = $1
      ORDER BY created_at DESC LIMIT 1
    `, [contactId])
    if (res.rows[0]) {
      await sendWhatsApp(jid, `Seu pedido *${res.rows[0].number}* está: *${statusLabel(res.rows[0].status)}*`)
    }
    return
  }

  const firstName = pushName.split(" ")[0]
  await sendWhatsApp(jid, `Oi ${firstName}! Seu pedido está sendo processado. Em breve temos novidades. Qualquer dúvida é só chamar!`)
}
