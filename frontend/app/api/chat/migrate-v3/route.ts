import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent'`)
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_message_id TEXT`)
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_content TEXT`)
    await pool.query(`UPDATE wa_messages SET status = 'sent' WHERE direction = 'out' AND status IS NULL`)
    return NextResponse.json({ ok: true, msg: "migrate-v3 complete" })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
