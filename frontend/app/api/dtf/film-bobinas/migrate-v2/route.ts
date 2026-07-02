import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      ALTER TABLE dtf_film_bobinas
        ADD COLUMN IF NOT EXISTS insumo_saida_id INTEGER
          REFERENCES dtf_insumo_saidas(id) ON DELETE SET NULL
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
