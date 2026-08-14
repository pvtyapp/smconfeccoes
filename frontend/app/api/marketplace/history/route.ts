import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, number, origin, total_items AS "totalItems", total_pieces AS "totalPieces",
             created_at AS "createdAt", canceled_at AS "canceledAt"
      FROM marketplace_separations
      ORDER BY created_at DESC
      LIMIT 50
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
