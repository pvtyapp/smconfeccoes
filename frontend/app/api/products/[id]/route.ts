import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, category, description, defaultSalePrice, averageCost, status } = body

    const { rows } = await pool.query(`
      UPDATE products
      SET
        name               = COALESCE($1, name),
        category           = COALESCE($2, category),
        description        = COALESCE($3, description),
        default_sale_price = COALESCE($4, default_sale_price),
        average_cost       = COALESCE($5, average_cost),
        status             = COALESCE($6, status)
      WHERE id = $7
      RETURNING
        id, name, category, description,
        default_sale_price AS "defaultSalePrice",
        average_cost       AS "averageCost",
        status,
        created_at         AS "createdAt"
    `, [name ?? null, category ?? null, description ?? null, defaultSalePrice ?? null, averageCost ?? null, status ?? null, id])

    if (rows.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("PUT /api/products/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query("UPDATE products SET status = 'inactive' WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("DELETE /api/products/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
