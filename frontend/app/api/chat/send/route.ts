import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp, type QuotedMsg } from "@/lib/whatsapp/send"
import { getSessionFromRequest } from "@/lib/session"

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      jid: string
      content: string
      contactId?: number
      quotedMsgId?: string
      quotedContent?: string
      quotedFromMe?: boolean
    }

    const { jid, content, contactId, quotedMsgId, quotedContent, quotedFromMe } = body
    if (!jid || !content?.trim())
      return NextResponse.json({ error: "jid e content são obrigatórios" }, { status: 400 })

    // Assina a mensagem com quem está logado — nome em negrito, função em itálico.
    // Vem da sessão validada no servidor, não do que o navegador manda, então
    // ninguém consegue enviar em nome de outro operador.
    const session = await getSessionFromRequest()
    const signature = session
      ? `*${session.name}*${session.funcao ? ` _${session.funcao}_` : ""}\n`
      : ""
    const text = `${signature}${content.trim()}`

    // Resolve the actual send JID: for @lid contacts, use phone_jid (@s.whatsapp.net)
    // so Evolution sends using the real phone number and fromMe webhook comes back correctly
    let sendJid = jid
    if (contactId && jid.endsWith("@lid")) {
      const { rows: jidRows } = await pool.query(
        `SELECT COALESCE(phone_jid, CONCAT(phone, '@s.whatsapp.net')) AS send_jid
         FROM wa_contacts WHERE id = $1 AND phone_jid IS NOT NULL LIMIT 1`,
        [contactId]
      ).catch(() => ({ rows: [] as { send_jid: string }[] }))
      if (jidRows[0]?.send_jid) sendJid = jidRows[0].send_jid
    }

    const quoted: QuotedMsg | undefined = quotedMsgId
      ? { id: quotedMsgId, fromMe: quotedFromMe ?? false, remoteJid: sendJid, content: quotedContent ?? "" }
      : undefined

    let evoOk = false
    let evoError = ""
    let evoMsgId: string | null = null
    try {
      const evoRes = await sendWhatsApp(sendJid, text, quoted)
      evoOk = true
      evoMsgId = (evoRes as Record<string, unknown>)?.key
        ? ((evoRes as Record<string, Record<string, unknown>>).key?.id as string) ?? null
        : null
    } catch (err) {
      evoError = err instanceof Error ? err.message : String(err)
    }

    const qMsgId   = quotedMsgId  ?? null
    const qContent = quotedContent ?? null

    if (contactId) {
      await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, quoted_id, quoted_text)
         VALUES ($1, $2, 'out', $3, $6, $4, $5)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [contactId, evoMsgId, text, qMsgId, qContent, evoOk ? "sent" : "failed"]
      ).catch(() => {})
    } else if (jid.endsWith("@s.whatsapp.net")) {
      const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      const { rows } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone) VALUES ($1, NULL, $2)
         ON CONFLICT (jid) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [jid, phone]
      ).catch(() => ({ rows: [] as { id: number }[] }))
      if (rows[0]?.id) {
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, quoted_id, quoted_text)
           VALUES ($1, $2, 'out', $3, 'sent', $4, $5)
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [rows[0].id, evoMsgId, text, qMsgId, qContent]
        ).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true, evoOk, evoError: evoError || undefined })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
