import { pool } from "@/lib/db"
import { downloadEvolutionMedia, uploadToBlob, classifyMediaCategory } from "@/lib/whatsapp/media"
import { waitUntil } from "@vercel/functions"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export type PendingMedia = { rec: Record<string, unknown>; msgId: string; mediaType: string }

function b64(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === "string") return raw
  if (typeof raw === "object") {
    const vals = Object.values(raw as Record<string, number>)
    if (vals.length && typeof vals[0] === "number")
      return Buffer.from(new Uint8Array(vals)).toString("base64")
  }
  return null
}

const folderMap: Record<string, "dtf" | "pix" | "media" | "audio" | "docs"> = {
  foto:      "media",
  video:     "media",
  audio:     "audio",
  pix:       "pix",
  dtf:       "dtf",
  documento: "docs",
  sticker:   "media",
}

export async function downloadSyncedMedia(pending: PendingMedia[], contactId: number): Promise<void> {
  for (const { rec, msgId, mediaType } of pending) {
    try {
      const media = await downloadEvolutionMedia(rec)
      if (!media) continue
      const category = classifyMediaCategory(mediaType, media.mimeType, "idle")
      const folder   = folderMap[category] ?? "media"
      const url      = await uploadToBlob(media.base64, media.mimeType, media.filename, folder)
      if (!url) continue
      await pool.query(
        `UPDATE wa_messages SET media_url = $1, media_category = $2 WHERE contact_id = $3 AND message_id = $4`,
        [url, category, contactId, msgId]
      ).catch(() => {})
    } catch { /* individual failure is non-fatal */ }
  }
}

// Fetches last 80 messages from Evolution for a JID, upserts to wa_messages.
// Returns pending media items for background blob upload.
export async function syncMessagesFromEvolution(jid: string, contactId: number): Promise<PendingMedia[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6_000)
  const pending: PendingMedia[] = []
  try {
    const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 80 }),
      signal: ctrl.signal,
    })
    if (!res.ok) return pending

    const data = await res.json()
    const records: unknown[] =
      Array.isArray(data) ? data :
      Array.isArray(data?.messages?.records) ? data.messages.records :
      Array.isArray(data?.records) ? data.records : []

    for (const r of records) {
      const rec = r as Record<string, unknown>
      const key   = rec.key as Record<string, unknown> | undefined
      const msgId = key?.id as string | undefined
      if (!msgId) continue

      const fromMe    = Boolean(key?.fromMe)
      const direction = fromMe ? "out" : "in"

      const msgObj = rec.message as Record<string, unknown> | undefined
      const text: string =
        (msgObj?.conversation as string) ||
        ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
        ""

      let mediaType: string | null = null
      let mediaUrl: string | null  = null
      let fileName: string | null  = null
      let caption: string | null   = null
      if (msgObj) {
        if (msgObj.imageMessage) {
          const m = msgObj.imageMessage as Record<string, unknown>
          mediaType = "image"
          const thumb = b64(m.jpegThumbnail)
          if (thumb) mediaUrl = `data:image/jpeg;base64,${thumb}`
          caption = (m.caption as string) ?? null
        } else if (msgObj.videoMessage) {
          const m = msgObj.videoMessage as Record<string, unknown>
          mediaType = "video"
          const thumb = b64(m.jpegThumbnail)
          if (thumb) mediaUrl = `data:image/jpeg;base64,${thumb}`
          caption = (m.caption as string) ?? null
        } else if (msgObj.audioMessage) {
          mediaType = "audio"
        } else if (msgObj.documentMessage) {
          const m = msgObj.documentMessage as Record<string, unknown>
          mediaType = "document"
          fileName = (m.fileName as string) ?? null
          caption  = (m.caption as string) ?? null
        } else if (msgObj.stickerMessage) {
          const m = msgObj.stickerMessage as Record<string, unknown>
          mediaType = "sticker"
          const thumb = b64(m.jpegThumbnail)
          if (thumb) mediaUrl = `data:image/jpeg;base64,${thumb}`
        }
      }

      const ctxInfo = (() => {
        if (!msgObj) return null
        for (const src of [msgObj.extendedTextMessage, msgObj.imageMessage, msgObj.videoMessage, msgObj.audioMessage, msgObj.documentMessage]) {
          const ci = (src as Record<string, unknown> | undefined)?.contextInfo
          if (ci) return ci as Record<string, unknown>
        }
        return null
      })()
      const quotedMsgId: string | null    = (ctxInfo?.stanzaId as string) ?? null
      const quotedContent: string | null  = (() => {
        const qm = ctxInfo?.quotedMessage as Record<string, unknown> | undefined
        if (!qm) return null
        return (qm.conversation as string) || ((qm.extendedTextMessage as Record<string, unknown>)?.text as string) || "[mídia]"
      })()

      const content   = text || (mediaType ? `[${mediaType}]` : fromMe ? "[enviado]" : "[mídia]")
      const ts        = rec.messageTimestamp as number | undefined
      const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

      const { rowCount } = await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_url, file_name, caption, created_at, quoted_message_id, quoted_content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
           media_type        = COALESCE(wa_messages.media_type,        EXCLUDED.media_type),
           media_url         = COALESCE(wa_messages.media_url,         EXCLUDED.media_url),
           file_name         = COALESCE(wa_messages.file_name,         EXCLUDED.file_name),
           caption           = COALESCE(wa_messages.caption,           EXCLUDED.caption),
           quoted_message_id = COALESCE(wa_messages.quoted_message_id, EXCLUDED.quoted_message_id),
           quoted_content    = COALESCE(wa_messages.quoted_content,    EXCLUDED.quoted_content)
         RETURNING (xmax = 0) AS inserted`,
        [contactId, msgId, direction, content, mediaType, mediaUrl, fileName, caption, createdAt, quotedMsgId, quotedContent]
      ).catch(() => ({ rowCount: 0 }))

      if (mediaType && rowCount) {
        const existing = await pool.query(
          `SELECT media_url FROM wa_messages WHERE message_id = $1`, [msgId]
        ).catch(() => ({ rows: [] as { media_url: string | null }[] }))
        const existingUrl = existing.rows[0]?.media_url ?? null
        if (!existingUrl || !existingUrl.startsWith("https://")) {
          pending.push({ rec, msgId, mediaType })
        }
      }
    }
  } catch { /* timeout or Evolution offline */ }
  finally { clearTimeout(timer) }
  return pending
}

// Syncs messages for a contact and queues background media downloads.
// Safe to call fire-and-forget — all errors are caught internally.
export async function syncContactMessages(jid: string, contactId: number): Promise<void> {
  try {
    const pending = await syncMessagesFromEvolution(jid, contactId)
    if (pending.length > 0) {
      waitUntil(downloadSyncedMedia(pending, contactId))
    }
  } catch { /* non-fatal */ }
}
