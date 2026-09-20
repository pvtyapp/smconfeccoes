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
    // Replano "Saudação única" (2026-09-20) — 4 situações reais do contato,
    // cada uma com seu próprio cooldown de 6h. site_transition_notice_sent_at
    // vira no_history_notice_sent_at (era "manda 1x só pra sempre", agora
    // segue o mesmo padrão de 6h das outras 3).
    await pool.query(`
      ALTER TABLE wa_contacts RENAME COLUMN site_transition_notice_sent_at TO no_history_notice_sent_at
    `).catch(() => {})
    await pool.query(`
      ALTER TABLE wa_contacts
        ADD COLUMN IF NOT EXISTS no_history_notice_sent_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS application_pending_notice_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS has_history_notice_sent_at        TIMESTAMPTZ
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
