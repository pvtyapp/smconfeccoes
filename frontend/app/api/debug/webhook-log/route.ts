import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT key, value, NOW() AS fetched_at
      FROM app_settings
      WHERE key IN ('debug_last_webhook', 'debug_last_webhook_raw')
    `)
    const result: Record<string, unknown> = {}
    for (const r of rows) {
      try { result[r.key] = JSON.parse(r.value) } catch { result[r.key] = r.value }
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST: clear debug log
export async function DELETE() {
  try {
    await pool.query("DELETE FROM app_settings WHERE key LIKE 'debug_%'")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
