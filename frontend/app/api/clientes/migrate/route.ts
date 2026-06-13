import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_obs              TEXT`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_produto_enabled  BOOLEAN DEFAULT TRUE`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_dtf_enabled      BOOLEAN DEFAULT FALSE`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS is_vip                  BOOLEAN DEFAULT FALSE`)
    await client.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS is_bloqueado             BOOLEAN DEFAULT FALSE`)
    await client.query(`UPDATE wa_contacts SET chatbot_produto_enabled = TRUE  WHERE chatbot_produto_enabled IS NULL`)
    await client.query(`UPDATE wa_contacts SET chatbot_dtf_enabled     = FALSE WHERE chatbot_dtf_enabled IS NULL`)
    await client.query(`UPDATE wa_contacts SET is_vip                  = FALSE WHERE is_vip IS NULL`)
    await client.query(`UPDATE wa_contacts SET is_bloqueado            = FALSE WHERE is_bloqueado IS NULL`)
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
