import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Adds missing columns to wa_messages that the code already expects
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('sent','delivered','read','played'))`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS file_name TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS caption TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_message_id TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS quoted_content TEXT`)
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_category TEXT`)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
