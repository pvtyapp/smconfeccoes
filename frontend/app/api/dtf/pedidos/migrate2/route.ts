import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS is_paid  BOOLEAN     NOT NULL DEFAULT false`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS paid_at  TIMESTAMPTZ`)

    // wa_message_id already added by dtf-link but may not exist on older installs
    await client.query(`ALTER TABLE dtf_order_attachments ADD COLUMN IF NOT EXISTS wa_message_id INT REFERENCES wa_messages(id) ON DELETE SET NULL`)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
