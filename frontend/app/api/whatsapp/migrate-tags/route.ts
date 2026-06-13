import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_contact_tags (
        id         SERIAL PRIMARY KEY,
        contact_id INT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
        tag        VARCHAR(100) NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        source     VARCHAR(50)  NOT NULL DEFAULT 'chatbot',
        created_at TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE(contact_id, tag, value)
      );

      CREATE TABLE IF NOT EXISTS wa_contact_offers (
        id         SERIAL PRIMARY KEY,
        contact_id INT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
        offer_type VARCHAR(100) NOT NULL,
        offered_at TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wa_contact_offers_lookup
        ON wa_contact_offers(contact_id, offer_type, offered_at DESC);
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
