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
    return NextResponse.json({ ok: true, ...rows[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
