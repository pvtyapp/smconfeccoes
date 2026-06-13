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
       ORDER BY created_at DESC LIMIT 20`,
      [contactId]
    )

    // Mark in DB
    await pool.query(
      `UPDATE wa_messages SET read_at = NOW() WHERE contact_id = $1 AND direction = 'in' AND read_at IS NULL`,
      [contactId]
    )

    // Notify Evolution — send read receipt for each unread message (fire-and-forget)
    if (jid && unread.length > 0) {
      fetch(`${EVO_URL}/message/markAsRead/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({
          readMessages: unread.map((r: { message_id: string }) => ({
            key: { id: r.message_id, fromMe: false, remoteJid: jid }
          }))
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
