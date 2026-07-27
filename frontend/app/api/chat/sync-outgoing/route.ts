import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const contactId = parseInt(searchParams.get("contactId") ?? "0")
  const jid       = searchParams.get("jid") ?? ""

  if (!contactId || !jid) {
    return NextResponse.json({ synced: 0 })
  }

  try {
    const provider = await getProvider()
    const records = await provider.findMessages({
      where: { key: { remoteJid: jid, fromMe: true } },
      limit: 80,
      sort: { messageTimestamp: -1 },
    }, 5_000)

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

      // RETURNING id → só conta inserções reais (ON CONFLICT DO NOTHING não retorna nada)
      const result = await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, created_at)
         VALUES ($1, $2, 'out', $3, 'sent', COALESCE($4, NOW()))
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [contactId, msgId, content, ts]
      ).catch(() => ({ rows: [] as { id: number }[] }))

      if ((result as { rows: { id: number }[] }).rows.length > 0) {
        synced++
      }
    }

    return NextResponse.json({ synced })
  } catch {
    return NextResponse.json({ synced: 0 })
  }
}
