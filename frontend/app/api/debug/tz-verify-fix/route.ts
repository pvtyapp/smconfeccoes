import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: confere se a conversão corrigida (AT TIME ZONE 'UTC' AT TIME
// ZONE 'America/Sao_Paulo') agora subtrai 3h corretamente, em vez de somar.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, created_at,
             created_at AT TIME ZONE 'America/Sao_Paulo' AS old_broken_shift,
             created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo' AS new_fixed_shift,
             DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS new_fixed_date
      FROM stock_movements ORDER BY created_at DESC LIMIT 3
    `)
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
