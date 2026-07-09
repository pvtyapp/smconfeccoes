import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: confere o timezone da sessão do Postgres e compara
// CURRENT_DATE (usado no filtro do mapa) contra a data convertida pra
// America/Sao_Paulo — se forem diferentes, o filtro "hoje" do mapa pode
// perder eventos reais dependendo da hora do dia.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        current_setting('TIMEZONE') AS pg_timezone,
        NOW() AS now_raw,
        CURRENT_DATE AS current_date_raw,
        (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS today_brt,
        (NOW() AT TIME ZONE 'America/Sao_Paulo') AS now_brt
    `)
    const { rows: colType } = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'stock_movements' AND column_name = 'created_at'
    `)
    const { rows: sample } = await pool.query(`
      SELECT id, created_at, created_at AT TIME ZONE 'America/Sao_Paulo' AS shifted,
             DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS shifted_date
      FROM stock_movements ORDER BY created_at DESC LIMIT 3
    `)
    return NextResponse.json({ ok: true, ...rows[0], createdAtColumnType: colType[0], sample })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
