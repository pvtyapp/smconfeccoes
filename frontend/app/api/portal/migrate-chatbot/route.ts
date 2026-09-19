import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      ALTER TABLE wa_contacts
        ADD COLUMN IF NOT EXISTS site_transition_notice_sent_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS attendant_wait_notice_sent_at     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS known_customer_greeting_sent_at   TIMESTAMPTZ
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
