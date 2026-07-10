import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: audita tipos de coluna restantes pra fechar o levantamento
// completo do bug de timezone em relatórios e agendador.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name = 'dtf_pedidos' AND column_name = 'concluded_at')
         OR (table_name = 'orders' AND column_name = 'completed_at')
         OR (table_name = 'raw_material_entries' AND column_name = 'exhausted_at')
         OR (table_name = 'marketing_schedules' AND column_name = 'last_executed_at')
      ORDER BY table_name, column_name
    `)
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
