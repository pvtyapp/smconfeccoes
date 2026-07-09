import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: confere direto no banco quantas movimentações in/out
// existem hoje e ontem, pra saber se a ausência de entrada no mapa é falta
// de dado real ou bug de novo.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
        sm.type, COUNT(*) AS total
      FROM stock_movements sm
      WHERE sm.created_at >= NOW() - INTERVAL '2 days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `)
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
