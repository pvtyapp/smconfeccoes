import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export async function POST(req: Request) {
  try {
    const { contactId, jid } = await req.json() as { contactId: number; jid: string }
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

    // Fetch unread incoming message_ids before marking
    const { rows: unread } = await pool.query(
      `SELECT message_id FROM wa_messages
       WHERE contact_id = $1 AND direction = 'in' AND read_at IS NULL AND message_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 100`,
      [contactId]
    )

    // Mark in DB
    await pool.query(
      `UPDATE wa_messages SET read_at = NOW() WHERE contact_id = $1 AND direction = 'in' AND read_at IS NULL`,
      [contactId]
    )
    // Touch updated_at so status refresh on frontend reflects read state (requires migrate-v5)
    pool.query(
      `UPDATE wa_messages SET updated_at = NOW() WHERE contact_id = $1 AND direction = 'in'`,
      [contactId]
    ).catch(() => {})

    // Notify Evolution — send read receipt for each unread message (fire-and-forget)
    if (unread.length > 0) {
      // Use phone_jid (real @s.whatsapp.net) if contact is @lid — Evolution rejects @lid in markAsRead
      const { rows: cjid } = await pool.query(
        `SELECT COALESCE(phone_jid, jid) AS send_jid FROM wa_contacts WHERE id = $1`,
        [contactId]
      ).catch(() => ({ rows: [] }))
      const sendJid = (cjid[0]?.send_jid as string) || jid
      if (sendJid) {
        fetch(`${EVO_URL}/message/markAsRead/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: EVO_KEY },
          body: JSON.stringify({
            readMessages: unread.map((r: { message_id: string }) => ({
              key: { id: r.message_id, fromMe: false, remoteJid: sendJid }
            }))
          }),
          signal: AbortSignal.timeout(5_000),
        }).catch(e => console.error("[mark-read] Evolution markAsRead falhou:", e instanceof Error ? e.message : e))
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
