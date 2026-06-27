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

    // ── wa_messages v2: separação de thumbnail vs URL real, novos nomes ──────────
    // media_thumb: base64 do thumbnail recebido do Evolution (preview imediato)
    // media_url:   URL real do Vercel Blob (só preenchida após download completo)
    // media_failed: download permanentemente falhou (mídia expirou no Evolution)
    // quoted_id / quoted_text: substitui quoted_message_id / quoted_content
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_thumb  TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_failed BOOLEAN DEFAULT FALSE`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_id    TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_text  TEXT`)

    // Colunas que vieram via sync/route.ts mas estão fora do migrate original
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_category TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS file_name      TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS caption        TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS status         TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_message_id TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_content    TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_download_failed BOOLEAN DEFAULT FALSE`)

    // wa_contacts: phone_jid para mapeamento @lid → @s.whatsapp.net
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS phone_jid          TEXT`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_message_synced_at TIMESTAMPTZ`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS profile_pic         TEXT`)

    // ── Migração de dados: base64 em media_url → media_thumb ─────────────────────
    // media_url que começa com "data:" é thumbnail base64 — mover para media_thumb
    await client.query(`
      UPDATE wa_messages
      SET media_thumb = media_url, media_url = NULL
      WHERE media_url IS NOT NULL AND media_url LIKE 'data:%'
        AND media_thumb IS NULL
    `)

    // Migra media_download_failed → media_failed
    await client.query(`
      UPDATE wa_messages
      SET media_failed = TRUE
      WHERE media_download_failed = TRUE AND (media_failed IS NULL OR media_failed = FALSE)
    `)

    // Migra quoted_message_id → quoted_id
    await client.query(`
      UPDATE wa_messages
      SET quoted_id = quoted_message_id
      WHERE quoted_message_id IS NOT NULL AND quoted_id IS NULL
    `)

    // Migra quoted_content → quoted_text
    await client.query(`
      UPDATE wa_messages
      SET quoted_text = quoted_content
      WHERE quoted_content IS NOT NULL AND quoted_text IS NULL
    `)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true, msg: "Migration v2 completa" })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
