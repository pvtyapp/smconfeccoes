import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { syncMessagesFromEvolution, downloadSyncedMedia, type PendingMedia } from "@/lib/whatsapp/syncMessages"

// Throttle Evolution sync — 60s per contact (in-memory, resets on cold start — acceptable)
const syncThrottle = new Map<number, number>()
const SYNC_INTERVAL_MS = 60 * 1000

const PAGE_SIZE = 60

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const contactId = searchParams.get("contactId")
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

    const since   = searchParams.get("since")
    const afterId = searchParams.get("afterId")
    const noSync  = searchParams.get("noSync") === "1"
    const offset  = parseInt(searchParams.get("offset") ?? "0") || 0

    // Incremental poll — no sync, no pagination.
    // afterId (preferred): queries by DB id so synced historical messages are never missed.
    // since (legacy): queries by created_at, kept for backward compat only.
    if (afterId !== null || since) {
      const SEL = `
        SELECT
          id, message_id AS "messageId", direction, content,
          media_type        AS "mediaType",
          media_url         AS "mediaUrl",
          media_category    AS "mediaCategory",
          file_name         AS "fileName",
          caption,
          status,
          quoted_message_id AS "quotedMessageId",
          quoted_content    AS "quotedContent",
          read_at           AS "readAt",
          created_at        AS "createdAt"
        FROM wa_messages`

      let rows: unknown[]
      if (afterId !== null) {
        const { rows: r } = await pool.query(
          `${SEL} WHERE contact_id = $1 AND id > $2 ORDER BY id ASC`,
          [contactId, parseInt(afterId) || 0]
        )
        rows = r
      } else {
        const { rows: r } = await pool.query(
          `${SEL} WHERE contact_id = $1 AND created_at > $2 ORDER BY created_at ASC`,
          [contactId, since]
        )
        rows = r
      }
      return NextResponse.json(rows)
    }

    // Full load — sync on first page only (unless noSync=1), throttled to once per 5min per contact
    const contactRes = await pool.query("SELECT jid FROM wa_contacts WHERE id = $1", [contactId])
    const jid: string | undefined = contactRes.rows[0]?.jid
    let pending: PendingMedia[] = []
    const cid = Number(contactId)
    const now = Date.now()
    const lastSync = syncThrottle.get(cid) ?? 0
    if (jid && offset === 0 && !noSync && (now - lastSync) > SYNC_INTERVAL_MS) {
      syncThrottle.set(cid, now)
      pending = await syncMessagesFromEvolution(jid, cid)
    }

    const { rows } = await pool.query(`
      SELECT
        id, message_id AS "messageId", direction, content,
        media_type        AS "mediaType",
        media_url         AS "mediaUrl",
        media_category    AS "mediaCategory",
        file_name         AS "fileName",
        caption,
        status,
        quoted_message_id AS "quotedMessageId",
        quoted_content    AS "quotedContent",
        read_at           AS "readAt",
        created_at        AS "createdAt"
      FROM (
        SELECT id, message_id, direction, content, media_type, media_url, media_category,
               file_name, caption, status, quoted_message_id, quoted_content, read_at, created_at
        FROM wa_messages
        WHERE contact_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      ) sub
      ORDER BY created_at ASC
    `, [contactId, PAGE_SIZE + 1, offset])

    const hasMore = rows.length > PAGE_SIZE
    const messages = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    // Background: download full media for synced messages that don't have blob URLs yet
    if (pending.length > 0) {
      waitUntil(downloadSyncedMedia(pending, Number(contactId)))
    }

    return NextResponse.json({ messages, hasMore })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
