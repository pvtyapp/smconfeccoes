import { pool } from "@/lib/db"
import { downloadEvolutionMedia, classifyMediaCategory } from "@/lib/whatsapp/media"
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

// Downloads full media from Evolution, saves base64 directly in media_data (PostgreSQL/Railway).
// Sets media_failed = TRUE if Evolution returns null (expired after ~30 days).
export async function downloadSyncedMedia(pending: PendingMedia[], contactId: number): Promise<void> {
  for (const { rec, msgId, mediaType } of pending) {
    try {
      const media = await downloadEvolutionMedia(rec)
      if (!media) {
        await pool.query(
          `UPDATE wa_messages SET media_failed = TRUE WHERE contact_id = $1 AND message_id = $2`,
          [contactId, msgId]
        ).catch(() => {})
        continue
      }
      const category  = classifyMediaCategory(mediaType, media.mimeType, "idle")
      const dataUrl   = `data:${media.mimeType};base64,${media.base64}`
      await pool.query(
        `UPDATE wa_messages SET media_data = $1, media_category = $2, media_failed = FALSE
         WHERE contact_id = $3 AND message_id = $4`,
        [dataUrl, category, contactId, msgId]
      ).catch(() => {})
    } catch { /* individual failure is non-fatal */ }
  }
}

// Fetches messages from Evolution for a JID, upserts into wa_messages.
// Stores thumbnail in media_thumb (base64) and leaves media_url NULL until blob download.
// Returns pending media items for background blob upload + count of records processed.
export async function syncMessagesFromEvolution(
  jid: string,
  contactId: number,
  options: { afterTs?: number } = {}
): Promise<{ pending: PendingMedia[]; processedCount: number }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6_000)
  const pending: PendingMedia[] = []
  let records: unknown[] = []
  try {
    const where: Record<string, unknown> = { key: { remoteJid: jid } }
    if (options.afterTs) where.messageTimestamp = { $gt: options.afterTs }
    const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where, limit: 200 }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { pending, processedCount: 0 }

    const data = await res.json()
    records =
      Array.isArray(data) ? data :
      Array.isArray(data?.messages?.records) ? data.messages.records :
      Array.isArray(data?.records) ? data.records :
      Array.isArray(data?.data) ? data.data :
      Array.isArray(data?.messages) ? data.messages :
      []

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

      // Extract media metadata — thumbnail goes to media_thumb, NOT media_url
      let mediaType:  string | null = null
      let mediaThumb: string | null = null   // base64 preview only
      let fileName:   string | null = null
      let caption:    string | null = null

      if (msgObj) {
        if (msgObj.imageMessage) {
          const m = msgObj.imageMessage as Record<string, unknown>
          mediaType  = "image"
          const t = b64(m.jpegThumbnail)
          if (t) mediaThumb = `data:image/jpeg;base64,${t}`
          caption = (m.caption as string) ?? null
        } else if (msgObj.videoMessage) {
          const m = msgObj.videoMessage as Record<string, unknown>
          mediaType  = "video"
          const t = b64(m.jpegThumbnail)
          if (t) mediaThumb = `data:image/jpeg;base64,${t}`
          caption = (m.caption as string) ?? null
        } else if (msgObj.audioMessage) {
          mediaType = "audio"
        } else if (msgObj.documentMessage) {
          const m = msgObj.documentMessage as Record<string, unknown>
          mediaType = "document"
          fileName  = (m.fileName as string) ?? null
          caption   = (m.caption as string) ?? null
        } else if (msgObj.stickerMessage) {
          const m = msgObj.stickerMessage as Record<string, unknown>
          mediaType = "sticker"
          const t = b64(m.jpegThumbnail)
          if (t) mediaThumb = `data:image/jpeg;base64,${t}`
        }
      }

      // Extract quoted message context
      const ctxInfo = (() => {
        if (!msgObj) return null
        for (const src of [msgObj.extendedTextMessage, msgObj.imageMessage, msgObj.videoMessage, msgObj.audioMessage, msgObj.documentMessage]) {
          const ci = (src as Record<string, unknown> | undefined)?.contextInfo
          if (ci) return ci as Record<string, unknown>
        }
        return null
      })()
      const quotedId: string | null   = (ctxInfo?.stanzaId as string) ?? null
      const quotedText: string | null = (() => {
        const qm = ctxInfo?.quotedMessage as Record<string, unknown> | undefined
        if (!qm) return null
        return (qm.conversation as string) || ((qm.extendedTextMessage as Record<string, unknown>)?.text as string) || "[mídia]"
      })()

      const content   = text || (mediaType ? `[${mediaType}]` : fromMe ? "[enviado]" : "[mídia]")
      const ts        = rec.messageTimestamp as number | undefined
      const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

      // Mensagens inbound com mais de 24h → auto-mark como lidas (evita badges enganosos)
      const isOldMsg = ts ? (Date.now() - ts * 1000 > 24 * 60 * 60 * 1000) : false
      const readAt   = (direction === "in" && isOldMsg) ? createdAt : null

      const { rowCount } = await pool.query(
        `INSERT INTO wa_messages
           (contact_id, message_id, direction, content,
            media_type, media_thumb, file_name, caption,
            created_at, quoted_id, quoted_text, read_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
           media_type  = COALESCE(wa_messages.media_type,  EXCLUDED.media_type),
           media_thumb = COALESCE(wa_messages.media_thumb, EXCLUDED.media_thumb),
           file_name   = COALESCE(wa_messages.file_name,   EXCLUDED.file_name),
           caption     = COALESCE(wa_messages.caption,     EXCLUDED.caption),
           quoted_id   = COALESCE(wa_messages.quoted_id,   EXCLUDED.quoted_id),
           quoted_text = COALESCE(wa_messages.quoted_text, EXCLUDED.quoted_text),
           read_at     = COALESCE(wa_messages.read_at,     EXCLUDED.read_at)`,
        [contactId, msgId, direction, content,
         mediaType, mediaThumb, fileName, caption,
         createdAt, quotedId, quotedText, readAt]
      ).catch(() => ({ rowCount: 0 }))

      // Queue for full media download if this message has media and no data yet
      if (mediaType && rowCount) {
        const { rows: existing } = await pool.query(
          `SELECT media_data, media_failed FROM wa_messages WHERE message_id = $1`, [msgId]
        ).catch(() => ({ rows: [] as { media_data: string | null; media_failed: boolean }[] }))
        const alreadyHasData = !!existing[0]?.media_data
        const alreadyFailed  = existing[0]?.media_failed ?? false
        if (!alreadyFailed && !alreadyHasData) {
          pending.push({ rec, msgId, mediaType })
        }
      }
    }
  } catch { /* timeout or Evolution offline */ }
  finally { clearTimeout(timer) }
  return { pending, processedCount: records.length }
}

export async function syncContactMessages(jid: string, contactId: number): Promise<void> {
  try {
    const { pending } = await syncMessagesFromEvolution(jid, contactId)
    if (pending.length > 0) {
      waitUntil(downloadSyncedMedia(pending, contactId))
    }
  } catch { /* non-fatal */ }
}
