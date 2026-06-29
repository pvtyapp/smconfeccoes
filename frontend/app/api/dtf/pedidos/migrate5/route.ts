import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS impressora_id INTEGER DEFAULT NULL
    `)
    return NextResponse.json({ ok: true, message: "impressora_id adicionado a dtf_pedidos" })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
