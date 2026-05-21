import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        category_id        AS "categoryId",
        description,
        sale_price         AS "salePrice",
        material_cost      AS "materialCost",
        labor_cost         AS "laborCost",
        additional_costs   AS "additionalCosts",
        daily_production   AS "dailyProduction",
        COALESCE(size_list, '{}')  AS sizes,
        COALESCE(color_list, '{}') AS colors,
        status,
        chatbot_enabled    AS "chatbotEnabled",
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
    const { name, categoryId, description, salePrice, materialCost, laborCost, additionalCosts, dailyProduction, sizes, colors, chatbotEnabled } = body

    if (!name?.trim()) return NextResponse.json({ error: "name é obrigatório" }, { status: 400 })

    const sizeArr = Array.isArray(sizes) ? sizes.filter(Boolean) : []
    const colorArr = Array.isArray(colors) ? colors.filter(Boolean) : []

    const { rows } = await pool.query(`
      INSERT INTO products (name, category_id, description, sale_price, material_cost, labor_cost, additional_costs, daily_production, size_list, color_list, chatbot_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    `, [name.trim(), categoryId ?? null, description ?? null, salePrice ?? 0, materialCost ?? 0, laborCost ?? 0, additionalCosts ?? 0, dailyProduction ?? 0, sizeArr, colorArr, chatbotEnabled ?? false])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/products:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
