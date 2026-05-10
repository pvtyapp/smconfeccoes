import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { color, size, sku, salePrice, averageCost, minStock, targetStock, status } = body

    const { rows } = await pool.query(`
      UPDATE product_variants
      SET
        color        = COALESCE($1, color),
        size         = COALESCE($2, size),
        sku          = COALESCE($3, sku),
        sale_price   = COALESCE($4, sale_price),
        average_cost = COALESCE($5, average_cost),
        min_stock    = COALESCE($6, min_stock),
        target_stock = COALESCE($7, target_stock),
        status       = COALESCE($8, status)
      WHERE id = $9
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
    `, [color ?? null, size ?? null, sku ?? null, salePrice ?? null, averageCost ?? null, minStock ?? null, targetStock ?? null, status ?? null, id])

    if (rows.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("PUT /api/variants/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query("UPDATE product_variants SET status = 'inactive' WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("DELETE /api/variants/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
