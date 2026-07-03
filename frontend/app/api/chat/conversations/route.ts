import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export async function DELETE(req: Request) {
  try {
    const { contactId, jid } = await req.json() as { contactId: number; jid: string }
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

    // Unlink DTF attachments before deleting messages (nullable FK)
    await pool.query(
      `UPDATE dtf_order_attachments SET wa_message_id = NULL
       WHERE wa_message_id IN (SELECT id FROM wa_messages WHERE contact_id = $1)`,
      [contactId]
    ).catch(() => {})
    // Delete from our DB (keep wa_contacts for CRM)
    await pool.query("DELETE FROM wa_messages WHERE contact_id = $1", [contactId])

    // Delete chat from Evolution (clears from PIV's WhatsApp)
    if (jid) {
      fetch(`${EVO_URL}/chat/delete/${EVO_INSTANCE}`, {
        method: "DELETE",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ remoteJid: jid }),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit  = Math.min(parseInt(searchParams.get("limit")  ?? "20"), 100)
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0"), 0)

    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.jid,
        c.profile_pic            AS "profilePic",
        c.lifecycle_state        AS "lifecycleState",
        c.needs_attention        AS "needsAttention",
        c.attention_reason       AS "attentionReason",
        c.state                  AS "state",
        c.chatbot_paused_until   AS "chatbotPausedUntil",
        lm.content               AS "lastMessage",
        lm.direction             AS "lastDirection",
        lm.created_at            AS "lastAt",
        COALESCE(ur.unread, 0)   AS unread
      FROM wa_contacts c
      JOIN LATERAL (
        SELECT content, direction, created_at
        FROM wa_messages
        WHERE contact_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN (
        SELECT contact_id, COUNT(*) AS unread
        FROM wa_messages
        WHERE direction = 'in' AND read_at IS NULL
        GROUP BY contact_id
      ) ur ON ur.contact_id = c.id
      ORDER BY lm.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit + 1, offset])

    const hasMore       = rows.length > limit
    const conversations = hasMore ? rows.slice(0, limit) : rows
    return NextResponse.json({ conversations, hasMore })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
