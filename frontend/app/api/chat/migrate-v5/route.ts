import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // updated_at para rastrear mudanças de status/read_at sem depender de created_at
    await client.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`)
    await client.query(`UPDATE wa_messages SET updated_at = created_at WHERE updated_at IS NULL`)

    // Índices compostos para queries mais comuns (poll incremental + TTL cleanup)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_msg_contact_created ON wa_messages(contact_id, created_at DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_msg_contact_updated ON wa_messages(contact_id, updated_at DESC)`)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true, message: "migrate-v5 concluída" })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
