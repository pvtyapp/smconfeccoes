import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: confere se existe pedido histórico de verdade com
// source='manual' antes de decidir remover esse canal do relatório/dashboard.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, number, status, total_value AS "totalValue", created_at AS "createdAt", contact_id AS "contactId"
      FROM orders WHERE source = 'manual' ORDER BY created_at DESC LIMIT 30
    `)
    const { rows: count } = await pool.query(`SELECT COUNT(*)::int AS total FROM orders WHERE source = 'manual'`)
    return NextResponse.json({ ok: true, total: count[0].total, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
