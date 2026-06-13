import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/dtf/preco — returns sale_price from the DTF product (single source of truth)
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, sale_price AS "precoMetro"
      FROM products
      WHERE LOWER(name) LIKE 'dtf%' AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    if (!rows[0]) return NextResponse.json({ precoMetro: null }, { status: 200 })
    return NextResponse.json({ precoMetro: Number(rows[0].precoMetro), productName: rows[0].name })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
