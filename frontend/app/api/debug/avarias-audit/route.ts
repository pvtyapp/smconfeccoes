import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: audita defect_stock pra investigar bug de histórico de 30
// dias e falha ao descartar.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, product_name AS "productName", color, size, qty, disposition,
             variant_id AS "variantId", created_at AS "createdAt", resolved_at AS "resolvedAt"
      FROM defect_stock ORDER BY created_at DESC LIMIT 40
    `)
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'defect_stock' ORDER BY ordinal_position
    `)
    return NextResponse.json({ ok: true, columns: cols, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
