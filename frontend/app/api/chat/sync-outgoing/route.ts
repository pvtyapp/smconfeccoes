import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL  = process.env.EVOLUTION_API_URL!
const EVO_KEY  = process.env.EVOLUTION_API_KEY!
const EVO_INST = process.env.EVOLUTION_INSTANCE!

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const contactId = parseInt(searchParams.get("contactId") ?? "0")
  const jid       = searchParams.get("jid") ?? ""

  if (!contactId || !jid) {
    return NextResponse.json({ synced: 0 })
  }

  try {
    const resp = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INST}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        where: { key: { remoteJid: jid, fromMe: true } },
        limit: 80,
        sort: { messageTimestamp: -1 },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!resp.ok) return NextResponse.json({ synced: 0 })

    const data    = await resp.json()
    const records = (data?.messages?.records ?? []) as Record<string, unknown>[]

    let synced = 0
    for (const rec of records) {
      const key    = rec.key as Record<string, unknown> | undefined
      const msgId  = key?.id as string | null ?? null
      const msgBody = rec.message as Record<string, unknown> | undefined

      let content = ""
      if (msgBody?.conversation)
        content = msgBody.conversation as string
      else if ((msgBody?.extendedTextMessage as Record<string, unknown>)?.text)
        content = (msgBody!.extendedTextMessage as Record<string, unknown>).text as string
      else if (msgBody?.imageMessage)    content = "[📸 imagem]"
      else if (msgBody?.audioMessage)    content = "[🎤 áudio]"
      else if (msgBody?.videoMessage) {
        const cap = (msgBody.videoMessage as Record<string, unknown>)?.caption as string
        content = cap ? `[🎥 vídeo] ${cap}` : "[🎥 vídeo]"
      } else if (msgBody?.documentMessage)
        content = (msgBody.documentMessage as Record<string, unknown>)?.fileName as string || "[📄 documento]"
      else if (msgBody?.stickerMessage)  content = "[🎨 sticker]"

      if (!content) continue

      const ts = rec.messageTimestamp
        ? new Date(Number(rec.messageTimestamp) * 1000)
        : null

      await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, created_at)
         VALUES ($1, $2, 'out', $3, 'sent', COALESCE($4, NOW()))
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [contactId, msgId, content, ts]
      ).catch(() => {})

      synced++
    }

    return NextResponse.json({ synced })
  } catch {
    return NextResponse.json({ synced: 0 })
  }
}
