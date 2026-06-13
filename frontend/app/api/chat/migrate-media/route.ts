import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS file_name TEXT`)
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS caption TEXT`)
    await pool.query(`ALTER TABLE dtf_order_attachments ADD COLUMN IF NOT EXISTS wa_message_id INTEGER REFERENCES wa_messages(id) ON DELETE SET NULL`)
    return NextResponse.json({ ok: true, msg: "Colunas file_name, caption e wa_message_id adicionadas" })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
