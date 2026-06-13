import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export async function DELETE(req: Request) {
  try {
    const { contactId, jid } = await req.json() as { contactId: number; jid: string }
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

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

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.jid,
        c.profile_pic            AS "profilePic",
        c.lifecycle_state        AS "lifecycleState",
        c.needs_attention        AS "needsAttention",
        c.chatbot_paused_until   AS "chatbotPausedUntil",
        lm.content               AS "lastMessage",
        lm.direction             AS "lastDirection",
        lm.created_at            AS "lastAt",
        COALESCE(ur.unread, 0)   AS unread
      FROM wa_contacts c
      LEFT JOIN LATERAL (
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
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC
      LIMIT 100
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
