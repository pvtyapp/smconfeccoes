import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário, uso único: migra pedidos históricos com source='manual'
// pra 'whatsapp' (canal manual foi fundido no whatsapp — mesma etiqueta, mesma
// função de sempre).
export async function GET() {
  try {
    const { rows: before } = await pool.query(`
      SELECT id, number, status, total_value AS "totalValue", created_at AS "createdAt", contact_id AS "contactId"
      FROM orders WHERE source = 'manual' ORDER BY created_at DESC
    `)
    const { rows: migrated } = await pool.query(`
      UPDATE orders SET source = 'whatsapp' WHERE source = 'manual'
      RETURNING id, number, source
    `)
    return NextResponse.json({ ok: true, foundBefore: before.length, before, migrated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
