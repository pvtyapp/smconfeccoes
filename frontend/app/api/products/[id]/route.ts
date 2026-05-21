import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, categoryId, description, salePrice, costPrice, sizes, colors, status, chatbotEnabled } = body

    const sizeArr  = Array.isArray(sizes)  ? sizes.filter(Boolean)  : null
    const colorArr = Array.isArray(colors) ? colors.filter(Boolean) : null

    const { rows } = await pool.query(`
      UPDATE products SET
        name            = COALESCE($1, name),
        category_id     = COALESCE($2, category_id),
        description     = COALESCE($3, description),
        sale_price      = COALESCE($4, sale_price),
        material_cost   = COALESCE($5, material_cost),
        size_list       = COALESCE($6, size_list),
        color_list      = COALESCE($7, color_list),
        status          = COALESCE($8, status),
        chatbot_enabled = COALESCE($9, chatbot_enabled)
      WHERE id = $10
      RETURNING
        id, name,
        category_id   AS "categoryId",
        description,
        sale_price    AS "salePrice",
        material_cost AS "costPrice",
        COALESCE(size_list, '{}')  AS sizes,
        COALESCE(color_list, '{}') AS colors,
        status,
        chatbot_enabled AS "chatbotEnabled",
        created_at      AS "createdAt"
    `, [
      name ?? null,
      categoryId !== undefined ? (categoryId || null) : null,
      description ?? null,
      salePrice ?? null,
      costPrice ?? null,
      sizeArr,
      colorArr,
      status ?? null,
      chatbotEnabled ?? null,
      id,
    ])

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
  const client = await pool.connect()
  try {
    const { id } = await params
    await client.query("BEGIN")
    await client.query("DELETE FROM product_variants WHERE product_id = $1", [id])
    await client.query("DELETE FROM products WHERE id = $1", [id])
    await client.query("COMMIT")
    return NextResponse.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("foreign key")) {
      return NextResponse.json(
        { error: "Produto possui pedidos vinculados e não pode ser deletado." },
        { status: 409 }
      )
    }
    console.error("DELETE /api/products/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
