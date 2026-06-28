import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id            SERIAL PRIMARY KEY,
        title         TEXT NOT NULL DEFAULT '',
        content       TEXT NOT NULL,
        media_url     TEXT,
        audience_type TEXT NOT NULL DEFAULT 'lifecycle',
        audience_lifecycle TEXT,
        audience_group_jids TEXT[] NOT NULL DEFAULT '{}',
        scheduled_at  TIMESTAMPTZ,
        status        TEXT NOT NULL DEFAULT 'scheduled',
        sent_count    INT  NOT NULL DEFAULT 0,
        error_count   INT  NOT NULL DEFAULT 0,
        total_count   INT  NOT NULL DEFAULT 0,
        executed_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_schedules (
        id               SERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        days_of_week     INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
        time_of_day      TIME NOT NULL,
        audience_type    TEXT NOT NULL DEFAULT 'groups',
        audience_lifecycle TEXT,
        audience_group_jids TEXT[] NOT NULL DEFAULT '{}',
        active           BOOLEAN NOT NULL DEFAULT true,
        last_executed_at TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_schedule_items (
        id          SERIAL PRIMARY KEY,
        schedule_id INT NOT NULL REFERENCES marketing_schedules(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,
        media_url   TEXT,
        last_sent_at TIMESTAMPTZ,
        sent_count  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_schedule_executions (
        id          SERIAL PRIMARY KEY,
        schedule_id INT NOT NULL REFERENCES marketing_schedules(id) ON DELETE CASCADE,
        item_id     INT REFERENCES marketing_schedule_items(id) ON DELETE SET NULL,
        content     TEXT,
        media_url   TEXT,
        sent_count  INT NOT NULL DEFAULT 0,
        error_count INT NOT NULL DEFAULT 0,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Queue column for rate-limited sending
    await pool.query(`
      ALTER TABLE marketing_campaigns
      ADD COLUMN IF NOT EXISTS recipients_json JSONB
    `)

    // Lifecycle execution log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_executions (
        id         SERIAL PRIMARY KEY,
        contact_id INT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
        stage      TEXT NOT NULL,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status     TEXT NOT NULL DEFAULT 'sent'
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lce_sent_at  ON lifecycle_executions(sent_at DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lce_contact  ON lifecycle_executions(contact_id)`)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
