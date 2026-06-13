import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-time migration: backfill curioso → ausente, drop curioso columns
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rowCount: backfilled } = await client.query(`
      UPDATE wa_contacts
      SET lifecycle_state      = 'ausente',
          lifecycle_updated_at = NOW()
      WHERE lifecycle_state = 'curioso'
    `)

    await client.query(`ALTER TABLE wa_contacts DROP COLUMN IF EXISTS curioso_seq`)
    await client.query(`ALTER TABLE wa_contacts DROP COLUMN IF EXISTS curioso_started_at`)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true, backfilled })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
