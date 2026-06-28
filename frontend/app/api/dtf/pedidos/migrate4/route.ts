import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS attention_reason TEXT`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id INT REFERENCES orders(id)`)
    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES ('chatbot_idle_return_minutes', '30')
      ON CONFLICT (key) DO NOTHING
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
