import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { uploadToBlob } from "@/lib/whatsapp/media"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const jid        = formData.get("jid")        as string | null
    const contactId  = formData.get("contactId")  as string | null
    const caption    = formData.get("caption")    as string | null
    const file       = formData.get("file")       as File | null

    if (!jid || !file)
      return NextResponse.json({ error: "jid e file obrigatórios" }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const base64      = Buffer.from(arrayBuffer).toString("base64")
    const mimeType    = file.type || "application/octet-stream"
    const fileName    = file.name || "arquivo"

    // Determine Evolution mediatype
    let mediatype: "image" | "video" | "audio" | "document" = "document"
    if (mimeType.startsWith("image/")) mediatype = "image"
    else if (mimeType.startsWith("video/")) mediatype = "video"
    else if (mimeType.startsWith("audio/")) mediatype = "audio"

    const number = jid.replace("@s.whatsapp.net", "").replace("@g.us", "")

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

    // Save to DB
    if (contactId) {
      const text = caption || `[${mediatype}]`
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
