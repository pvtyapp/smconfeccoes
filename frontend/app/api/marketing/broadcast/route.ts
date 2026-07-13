import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

export async function POST(req: Request) {
  try {
    const { content, lifecycle } = await req.json()
    if (!content?.trim()) return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 })

    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})
    let query = `SELECT id, COALESCE(phone_jid, jid) AS jid, name FROM wa_contacts WHERE (phone_jid IS NOT NULL OR jid IS NOT NULL) AND linked_user_id IS NULL`
    const params: string[] = []
    if (lifecycle && lifecycle !== "all") {
      params.push(lifecycle)
      query += ` AND lifecycle_state = $1`
    }

    const { rows: contacts } = await pool.query(query, params)

    let sent = 0, errors = 0
    for (const c of contacts) {
      try {
        const msg = content.replace("{nome}", (c.name ?? "").split(" ")[0])
        const result = await sendWhatsApp(c.jid, msg) as { key?: { id?: string } }
        await pool.query(`
          INSERT INTO wa_messages (contact_id, message_id, direction, content)
          VALUES ($1, $2, 'out', $3)
          ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING
        `, [c.id, result?.key?.id ?? null, msg])
        sent++
        await new Promise(r => setTimeout(r, 300)) // throttle
      } catch { errors++ }
    }

    return NextResponse.json({ sent, errors, total: contacts.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
