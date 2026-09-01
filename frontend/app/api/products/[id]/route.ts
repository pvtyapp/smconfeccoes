import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { syncVariants } from "@/lib/products/syncVariants"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json()
    const {
      name, categoryId, description, salePrice, costPrice, sizes, colors, status, chatbotEnabled, stockEnabled, precoPorMetro, pesoCostura,
      ncm, cest, origem, csosn, unidadeTributavel, cfopDentroEstado, cfopForaEstado,
    } = body

    const sizeArr  = Array.isArray(sizes)  ? sizes.filter(Boolean)  : null
    const colorArr = Array.isArray(colors) ? colors.filter(Boolean) : null

    await client.query("BEGIN")
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS peso_costura NUMERIC(4,2) NOT NULL DEFAULT 1`).catch(() => {})

    const { rows } = await client.query(`
      UPDATE products SET
        name              = COALESCE($1, name),
        category_id       = COALESCE($2, category_id),
        description       = COALESCE($3, description),
        sale_price        = COALESCE($4, sale_price),
        material_cost     = COALESCE($5, material_cost),
        size_list         = COALESCE($6, size_list),
        color_list        = COALESCE($7, color_list),
        status            = COALESCE($8, status),
        chatbot_enabled   = COALESCE($9, chatbot_enabled),
        stock_enabled     = COALESCE($10, stock_enabled),
        preco_por_metro   = COALESCE($11, preco_por_metro),
        peso_costura      = COALESCE($13, peso_costura),
        ncm                 = COALESCE(NULLIF($14, ''), ncm),
        cest                = COALESCE(NULLIF($15, ''), cest),
        origem              = COALESCE(NULLIF($16, ''), origem),
        csosn               = COALESCE(NULLIF($17, ''), csosn),
        unidade_tributavel  = COALESCE(NULLIF($18, ''), unidade_tributavel),
        cfop_dentro_estado  = COALESCE(NULLIF($19, ''), cfop_dentro_estado),
        cfop_fora_estado    = COALESCE(NULLIF($20, ''), cfop_fora_estado)
      WHERE id = $12
      RETURNING
        id, name,
        category_id     AS "categoryId",
        description,
        sale_price      AS "salePrice",
        material_cost   AS "costPrice",
        COALESCE(peso_costura, 1)::float AS "pesoCostura",
        stock_enabled   AS "stockEnabled",
        COALESCE(preco_por_metro, false) AS "precoPorMetro",
        COALESCE(size_list, '{}')  AS sizes,
        COALESCE(color_list, '{}') AS colors,
        status,
        chatbot_enabled AS "chatbotEnabled",
        ncm, cest, origem, csosn,
        COALESCE(unidade_tributavel, 'UN')      AS "unidadeTributavel",
        COALESCE(cfop_dentro_estado, '5101')    AS "cfopDentroEstado",
        COALESCE(cfop_fora_estado, '6101')      AS "cfopForaEstado",
        created_at      AS "createdAt"
    `, [
      name ?? null,
      categoryId !== undefined ? (categoryId || null) : null,
      description ?? null,
      salePrice      ?? null,
      costPrice      ?? null,
      sizeArr,
      colorArr,
      status         ?? null,
      chatbotEnabled ?? null,
      stockEnabled   ?? null,
      precoPorMetro  ?? null,
      id,
      pesoCostura    ?? null,
      ncm ?? "", cest ?? "", origem ?? "", csosn ?? "",
      unidadeTributavel ?? "", cfopDentroEstado ?? "", cfopForaEstado ?? "",
    ])

    if (rows.length === 0) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    }

    const product = rows[0]

    // Sync variants whenever stockEnabled or sizes/colors changed
    if (stockEnabled !== undefined || sizeArr !== null || colorArr !== null) {
      await syncVariants(
        client,
        id,
        product.colors,
        product.sizes,
        product.salePrice,
        product.stockEnabled,
      )
    }

    await client.query("COMMIT")
    return NextResponse.json(product)
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
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
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
