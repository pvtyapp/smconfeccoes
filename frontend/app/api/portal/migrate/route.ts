import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Fase 1 do Portal do Cliente — conta, login e verificação por WhatsApp.
// Ver plano completo: artifact "Portal do Cliente SM".
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`
      CREATE TABLE IF NOT EXISTS client_accounts (
        id                    SERIAL PRIMARY KEY,
        contact_id            INTEGER NOT NULL UNIQUE REFERENCES wa_contacts(id),
        password_hash         TEXT NOT NULL,
        must_change_password  BOOLEAN NOT NULL DEFAULT false,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at         TIMESTAMPTZ
      )
    `)
    await client.query(`ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_otp_codes (
        id          SERIAL PRIMARY KEY,
        phone       TEXT NOT NULL,
        code        TEXT NOT NULL,
        purpose     TEXT NOT NULL DEFAULT 'signup',
        expires_at  TIMESTAMPTZ NOT NULL,
        attempts    SMALLINT NOT NULL DEFAULT 0,
        consumed_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_otp_purpose') THEN
          ALTER TABLE whatsapp_otp_codes ADD CONSTRAINT chk_otp_purpose
            CHECK (purpose IN ('signup', 'reset_password'));
        END IF;
      END $$
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_otp_phone_active
      ON whatsapp_otp_codes(phone, created_at DESC)
      WHERE consumed_at IS NULL
    `)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
