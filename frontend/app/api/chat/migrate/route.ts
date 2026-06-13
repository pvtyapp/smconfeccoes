import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // wa_messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_messages (
        id          BIGSERIAL PRIMARY KEY,
        contact_id  INT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
        message_id  TEXT,
        direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        content     TEXT,
        media_type  TEXT,
        media_url   TEXT,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_messages_contact
      ON wa_messages(contact_id, created_at DESC)
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_msg_id
      ON wa_messages(message_id)
      WHERE message_id IS NOT NULL
    `)

    // wa_groups
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_groups (
        id         BIGSERIAL PRIMARY KEY,
        jid        TEXT NOT NULL UNIQUE,
        name       TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // wa_group_messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_group_messages (
        id          BIGSERIAL PRIMARY KEY,
        group_id    BIGINT NOT NULL REFERENCES wa_groups(id) ON DELETE CASCADE,
        message_id  TEXT UNIQUE,
        sender_jid  TEXT,
        sender_name TEXT,
        content     TEXT,
        media_type  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_group_messages_group
      ON wa_group_messages(group_id, created_at DESC)
    `)

    // wa_contacts extra columns
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_paused_until TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_produto_enabled BOOLEAN NOT NULL DEFAULT true`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_dtf_enabled BOOLEAN NOT NULL DEFAULT false`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_obs TEXT`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'new'`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS novo_seq INT NOT NULL DEFAULT 0`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS novo_last_sent_at TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS ausente_seq INT NOT NULL DEFAULT 0`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS ausente_last_sent_at TIMESTAMPTZ`)
    // app_settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_contacts_attention ON wa_contacts(needs_attention)
      WHERE needs_attention = true
    `)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true, msg: "Migration completa" })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
