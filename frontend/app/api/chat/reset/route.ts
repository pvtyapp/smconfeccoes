import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`DELETE FROM wa_messages`)
    await pool.query(`DELETE FROM wa_group_messages`)
    await pool.query(`
      UPDATE wa_contacts SET
        state               = 'idle',
        state_data          = '{}',
        needs_attention     = false,
        chatbot_paused_until = null,
        last_message_synced_at = null,
        updated_at          = NOW()
    `)
    const { rows: [counts] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM wa_contacts) AS contacts,
        (SELECT COUNT(*) FROM wa_messages) AS messages
    `)
    return NextResponse.json({ ok: true, contacts: Number(counts.contacts), messages: Number(counts.messages) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
