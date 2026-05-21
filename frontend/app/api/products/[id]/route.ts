import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, categoryId, description, salePrice, materialCost, laborCost, additionalCosts, dailyProduction, sizes, colors, status, chatbotEnabled } = body

    const sizeArr = Array.isArray(sizes) ? sizes.filter(Boolean) : null
    const colorArr = Array.isArray(colors) ? colors.filter(Boolean) : null

    const { rows } = await pool.query(`
      UPDATE products SET
        name             = COALESCE($1, name),
        category_id      = COALESCE($2, category_id),
        description      = COALESCE($3, description),
        sale_price       = COALESCE($4, sale_price),
        material_cost    = COALESCE($5, material_cost),
        labor_cost       = COALESCE($6, labor_cost),
        additional_costs = COALESCE($7, additional_costs),
        daily_production = COALESCE($8, daily_production),
        size_list        = COALESCE($9, size_list),
        color_list       = COALESCE($10, color_list),
        status           = COALESCE($11, status),
        chatbot_enabled  = COALESCE($12, chatbot_enabled)
      WHERE id = $13
      RETURNING
        id, name,
        category_id      AS "categoryId",
        description,
        sale_price       AS "salePrice",
        material_cost    AS "materialCost",
        labor_cost       AS "laborCost",
        additional_costs AS "additionalCosts",
        daily_production AS "dailyProduction",
        COALESCE(size_list, '{}')  AS sizes,
        COALESCE(color_list, '{}') AS colors,
        status,
        chatbot_enabled  AS "chatbotEnabled",
        created_at AS "createdAt"
    `, [name ?? null, categoryId ?? null, description ?? null, salePrice ?? null, materialCost ?? null, laborCost ?? null, additionalCosts ?? null, dailyProduction ?? null, sizeArr, colorArr, status ?? null, chatbotEnabled ?? null, id])

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
