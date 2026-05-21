import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Evolution API sends a POST for each message event
export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Only handle incoming text messages
    const event = body?.event
    if (event !== "messages.upsert") return NextResponse.json({ ok: true })

    const msg = body?.data?.messages?.[0]
    if (!msg || msg.key?.fromMe) return NextResponse.json({ ok: true })

    const jid: string = msg.key?.remoteJid
    if (!jid || jid.endsWith("@g.us")) return NextResponse.json({ ok: true }) // skip groups

    const text: string = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ""
    if (!text.trim()) return NextResponse.json({ ok: true })

    const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    const pushName: string = msg.pushName || phone

    // Upsert contact
    const contactRes = await pool.query(`
      INSERT INTO wa_contacts (jid, name, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (jid) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id, state, state_data AS "stateData"
    `, [jid, pushName, phone])

    const contact = contactRes.rows[0]
    const state: string = contact.state ?? "idle"
    const stateData: Record<string, unknown> = contact.stateData ?? {}

    await handleState(jid, contact.id, state, stateData, text.trim())
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("WA webhook error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function setState(contactId: number, state: string, data: Record<string, unknown> = {}) {
  await pool.query(
    "UPDATE wa_contacts SET state = $1, state_data = $2, updated_at = NOW() WHERE id = $3",
    [state, JSON.stringify(data), contactId]
  )
}

async function handleState(
  jid: string,
  contactId: number,
  state: string,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower = text.toLowerCase()

  // Global commands
  if (lower === "cancelar" || lower === "cancel") {
    await setState(contactId, "idle")
    await sendWhatsApp(jid, "Tudo bem! Se quiser fazer um pedido é só mandar mensagem.")
    return
  }

  switch (state) {
    case "idle":
      await handleIdle(jid, contactId, text)
      break

    case "coletando":
      await handleColetando(jid, contactId, stateData, text)
      break

    case "aguardando_cliente_1":
      await handleAguardandoCliente1(jid, contactId, stateData, text)
      break

    default:
      // States controlled by dashboard (em_separacao, pronto etc.) — just acknowledge
      await sendWhatsApp(jid, "Seu pedido está sendo processado. Em breve retornaremos!")
  }
}

async function handleIdle(jid: string, contactId: number, text: string) {
  const lower = text.toLowerCase()
  const isOrder = lower.includes("pedido") || lower.includes("quero") || lower.includes("preciso") || lower.includes("comprar")

  if (isOrder) {
    await setState(contactId, "coletando", { rawMessages: [text] })
    // Try to parse immediately
    await tryParseAndConfirm(jid, contactId, [text])
  } else {
    await sendWhatsApp(jid, `Olá! 👋 Bem-vindo à *SM Confecções*.\n\nPara fazer um pedido, me diga quais produtos, cores e quantidades você precisa.\n\nExemplo: _20 moletom preto P, 20 preto M, 10 cinza G_`)
    await setState(contactId, "coletando", { rawMessages: [] })
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

  let parsed: Array<{ productName: string; color: string; size: string; qty: number }> = []
  try {
    parsed = await parseOrder(fullText)
  } catch {
    await sendWhatsApp(jid, "Entendido! Pode continuar descrevendo o pedido ou me diga quando terminar digitando *pronto*.")
    return
  }

  if (!parsed.length) {
    await sendWhatsApp(jid, "Ainda não consegui identificar os itens. Me diga os produtos, cores e tamanhos, ex: _20 moletom preto P_")
    return
  }

  // Build confirmation message
  let lines = parsed.map(
    (i, idx) => `${idx + 1}. ${i.productName} ${i.color} ${i.size} — *${i.qty} un*`
  )
  const msg =
    `Entendi o seu pedido:\n\n${lines.join("\n")}\n\n` +
    `Está correto? Responda *SIM* para confirmar ou *NÃO* para ajustar.`

  await setState(contactId, "aguardando_cliente_1", { parsed, rawMessages })
  await sendWhatsApp(jid, msg)
}

async function handleAguardandoCliente1(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower = text.toLowerCase().trim()

  if (lower === "sim" || lower === "s" || lower === "yes") {
    const parsed = stateData.parsed as Array<{ productName: string; color: string; size: string; qty: number }>

    // Create order
    const numRes = await pool.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    const orderRes = await pool.query(`
      INSERT INTO orders (number, contact_id, status)
      VALUES ($1, $2, 'triagem')
      RETURNING id, number
    `, [number, contactId])

    const orderId = orderRes.rows[0].id
    const orderNumber = orderRes.rows[0].number

    for (const item of parsed) {
      await pool.query(`
        INSERT INTO order_items (order_id, product_name, color, size, qty)
        VALUES ($1, $2, $3, $4, $5)
      `, [orderId, item.productName, item.color, item.size, item.qty])
    }

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'triagem', 'chatbot', 'Pedido confirmado pelo cliente')
    `, [orderId])

    await setState(contactId, "triagem", { orderId, orderNumber })
    await sendWhatsApp(
      jid,
      `✅ Pedido *${orderNumber}* recebido!\n\nNosso time vai revisar e confirmar em breve. Avisaremos aqui quando estiver pronto para retirada.`
    )
  } else if (lower === "não" || lower === "nao" || lower === "n" || lower === "no") {
    await setState(contactId, "coletando", { rawMessages: [] })
    await sendWhatsApp(jid, "Tudo bem! Me diga novamente como você quer o pedido.")
  } else {
    await sendWhatsApp(jid, "Por favor, responda *SIM* para confirmar ou *NÃO* para ajustar o pedido.")
  }
}
