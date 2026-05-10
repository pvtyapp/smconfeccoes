import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const productId = searchParams.get("productId")

    const { rows } = await pool.query(`
      SELECT
        pv.id,
        pv.product_id    AS "productId",
        p.name           AS "productName",
        pv.color,
        pv.size,
        pv.sku,
        pv.sale_price    AS "salePrice",
        pv.average_cost  AS "averageCost",
        pv.min_stock     AS "minStock",
        pv.target_stock  AS "targetStock",
        pv.status,
        pv.created_at    AS "createdAt"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      ${productId ? "WHERE pv.product_id = $1" : ""}
      ORDER BY p.name ASC, pv.color ASC, pv.size ASC
    `, productId ? [productId] : [])

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/variants:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { productId, color, size, sku, salePrice, averageCost, minStock, targetStock } = body

    if (!productId || !color?.trim() || !size?.trim() || !sku?.trim()) {
      return NextResponse.json({ error: "productId, color, size e sku são obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO product_variants
        (product_id, color, size, sku, sale_price, average_cost, min_stock, target_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        product_id   AS "productId",
        color, size, sku,
        sale_price   AS "salePrice",
        average_cost AS "averageCost",
        min_stock    AS "minStock",
        target_stock AS "targetStock",
        status,
        created_at   AS "createdAt"
    `, [productId, color.trim(), size.trim(), sku.trim(), salePrice ?? 0, averageCost ?? 0, minStock ?? 0, targetStock ?? 0])

    // Fetch productName for response
    const { rows: pRows } = await pool.query("SELECT name FROM products WHERE id = $1", [productId])
    return NextResponse.json({ ...rows[0], productName: pRows[0]?.name ?? "" }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/variants:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
