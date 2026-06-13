import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/chat/migrate-attention — add attention/pause columns to wa_contacts (run once)
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_paused_until TIMESTAMPTZ`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_contacts_attention ON wa_contacts(needs_attention) WHERE needs_attention = true`)
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
