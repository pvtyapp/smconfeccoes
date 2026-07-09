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
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name = 'stock_movements' AND column_name = 'created_at')
         OR (table_name = 'orders' AND column_name = 'created_at')
         OR (table_name = 'dtf_pedidos' AND column_name = 'created_at')
         OR (table_name = 'prod_orders' AND column_name IN ('created_at', 'concluded_at'))
         OR (table_name = 'raw_material_entries' AND column_name = 'created_at')
         OR (table_name = 'wa_contacts' AND column_name = 'last_greeting_sent_at')
    `)
    const { rows: sample } = await pool.query(`
      SELECT id, created_at, created_at AT TIME ZONE 'America/Sao_Paulo' AS shifted,
             DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS shifted_date
      FROM stock_movements ORDER BY created_at DESC LIMIT 3
    `)
    return NextResponse.json({ ok: true, ...rows[0], columnTypes: colType, sample })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
