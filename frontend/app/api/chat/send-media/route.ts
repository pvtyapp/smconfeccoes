import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

const ALLOWED_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4",
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/opus",
  "application/pdf", "image/svg+xml",
])

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const jid        = formData.get("jid")        as string | null
    const contactId  = formData.get("contactId")  as string | null
    const caption    = formData.get("caption")    as string | null
    const file       = formData.get("file")       as File | null

    if (!jid || !file)
      return NextResponse.json({ error: "jid e file obrigatórios" }, { status: 400 })

    const mimeType = file.type || "application/octet-stream"

    if (!ALLOWED_MIMES.has(mimeType))
      return NextResponse.json({ error: "Tipo de arquivo não permitido" }, { status: 415 })

    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json({ error: "Arquivo muito grande (máx. 50 MB)" }, { status: 413 })

    const arrayBuffer = await file.arrayBuffer()
    const base64      = Buffer.from(arrayBuffer).toString("base64")
    const fileName    = file.name || "arquivo"

    // Determine Evolution mediatype
    let mediatype: "image" | "video" | "audio" | "document" = "document"
    if (mimeType.startsWith("image/")) mediatype = "image"
    else if (mimeType.startsWith("video/")) mediatype = "video"
    else if (mimeType.startsWith("audio/")) mediatype = "audio"

    // Manda no jid original (@lid quando é esse o caso) — Evolution passou a
    // rejeitar envio em @s.whatsapp.net pra contatos migrados. Mesmo fix de
    // app/api/chat/send/route.ts.
    const sendJid = jid

    const number = sendJid.replace("@s.whatsapp.net", "").replace("@g.us", "")

    let evoMsgId: string | null = null

    try {
      const provider = await getProvider()
      const result = await provider.sendMedia(number, {
        mediatype, mimetype: mimeType, caption: caption ?? "", media: base64, fileName,
        timeoutMs: 12_000,
      })
      evoMsgId = result.id
    } catch { /* non-blocking */ }

    // Save to DB — store base64 directly in media_data (PostgreSQL storage)
    if (contactId) {
      const text     = caption || `[${mediatype}]`
      const mediaExt = mediatype === "document" ? "document" : mediatype === "image" ? "image" : mediatype
      const dataUrl  = `data:${mimeType};base64,${base64}`
      await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_data, file_name, caption)
         VALUES ($1, $2, 'out', $3, $4, $5, $6, $7)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [Number(contactId), evoMsgId, text, mediaExt, dataUrl, fileName, caption ?? null]
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, evoMsgId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
