import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { uploadToBlob } from "@/lib/whatsapp/media"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

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

    // Resolve real send JID: @lid contacts need the @s.whatsapp.net JID
    let sendJid = jid
    if (contactId && jid.endsWith("@lid")) {
      const { rows } = await pool.query(
        `SELECT COALESCE(phone_jid, CONCAT(phone, '@s.whatsapp.net')) AS send_jid
         FROM wa_contacts WHERE id = $1 AND phone_jid IS NOT NULL LIMIT 1`,
        [Number(contactId)]
      ).catch(() => ({ rows: [] as { send_jid: string }[] }))
      if (rows[0]?.send_jid) sendJid = rows[0].send_jid
    }

    const number = sendJid.replace("@s.whatsapp.net", "").replace("@g.us", "")

    let evoRes: Record<string, unknown> | null = null
    let evoMsgId: string | null = null

    try {
      const endpoint = mediatype === "document"
        ? `${EVO_URL}/message/sendDocument/${EVO_INSTANCE}`
        : `${EVO_URL}/message/sendMedia/${EVO_INSTANCE}`

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({ number, mediatype, mimetype: mimeType, caption: caption ?? "", media: base64, fileName }),
        signal: AbortSignal.timeout(12_000),
      })

      if (r.ok) {
        evoRes = await r.json() as Record<string, unknown>
        evoMsgId = (evoRes?.key as Record<string, unknown>)?.id as string ?? null
      }
    } catch { /* non-blocking */ }

    // Upload to Blob for our storage
    const folder = mediatype === "image" ? "media" : mediatype === "audio" ? "audio" : "docs"
    const blobUrl = await uploadToBlob(base64, mimeType, fileName, folder).catch(() => null)

    // Save to DB — media sent by us: media_url gets the real blob URL directly (no thumbnail needed)
    if (contactId) {
      const text     = caption || `[${mediatype}]`
      const mediaExt = mediatype === "document" ? "document" : mediatype === "image" ? "image" : mediatype
      await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_url, file_name, caption)
         VALUES ($1, $2, 'out', $3, $4, $5, $6, $7)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [Number(contactId), evoMsgId, text, mediaExt, blobUrl, fileName, caption ?? null]
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, evoMsgId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
