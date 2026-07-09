import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: confere de novo os in/out de hoje, com detalhe por linha,
// pra ver se as 4 entradas de mais cedo ainda estao la e por que o mapa mostra
// só 2 balões de saída.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT sm.id, sm.type, sm.quantity, sm.reason, sm.notes, sm.created_at AS "createdAt"
      FROM stock_movements sm
      WHERE DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE
      ORDER BY sm.created_at DESC
    `)
    return NextResponse.json({ ok: true, count: rows.length, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
