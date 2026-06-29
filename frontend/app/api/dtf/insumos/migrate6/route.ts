import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      ALTER TABLE dtf_insumo_saidas ADD COLUMN IF NOT EXISTS impressora_id INTEGER DEFAULT NULL
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
