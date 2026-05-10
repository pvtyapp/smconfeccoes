import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        category,
        description,
        default_sale_price AS "defaultSalePrice",
        average_cost       AS "averageCost",
        status,
        created_at         AS "createdAt"
      FROM products
      ORDER BY name ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/products:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, category, description, defaultSalePrice, averageCost } = body

    if (!name?.trim() || !category?.trim()) {
      return NextResponse.json({ error: "name e category são obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO products (name, category, description, default_sale_price, average_cost)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id, name, category, description,
        default_sale_price AS "defaultSalePrice",
        average_cost       AS "averageCost",
        status,
        created_at         AS "createdAt"
    `, [name.trim(), category.trim(), description ?? null, defaultSalePrice ?? 0, averageCost ?? 0])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/products:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
