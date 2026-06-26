import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 60

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const contactId = searchParams.get("contactId")
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

    const since   = searchParams.get("since")
    const afterId = searchParams.get("afterId")
    const offset  = parseInt(searchParams.get("offset") ?? "0") || 0

    // Incremental poll — afterId preferred (pk-based, never misses synced historical msgs)
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

      if (afterId !== null) {
        const { rows } = await pool.query(
          `${SEL} WHERE contact_id = $1 AND id > $2 ORDER BY id ASC`,
          [contactId, parseInt(afterId) || 0]
        )
        return NextResponse.json(rows)
      } else {
        const { rows } = await pool.query(
          `${SEL} WHERE contact_id = $1 AND created_at > $2 ORDER BY created_at ASC`,
          [contactId, since]
        )
        return NextResponse.json(rows)
      }
    }

    // Full load — paginated from DB only (cursor backfill populates the data)
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

    const hasMore  = rows.length > PAGE_SIZE
    const messages = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    return NextResponse.json({ messages, hasMore })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
