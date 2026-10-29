import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { syncVariants } from "@/lib/products/syncVariants"
import { getAcesso, ocultarValores } from "@/lib/acesso"

// Valores que só vão pra quem tem a permissão (lib/acesso.ts).
const CAMPOS_VALOR = { financeiro: ["costPrice"], preco: ["salePrice"] }

export async function GET() {
  try {
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS peso_costura NUMERIC(4,2) NOT NULL DEFAULT 1`).catch(() => {})
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        category_id     AS "categoryId",
        description,
        sale_price      AS "salePrice",
        material_cost   AS "costPrice",
        COALESCE(peso_costura, 1)::float AS "pesoCostura",
        stock_enabled     AS "stockEnabled",
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
      FROM products
      ORDER BY name ASC
    `)
    return NextResponse.json(ocultarValores(rows, await getAcesso(), CAMPOS_VALOR))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    // Valor que o usuário não vê também não é gravado por ele (chega null e o banco mantém).
    const body = ocultarValores(await req.json(), await getAcesso(), CAMPOS_VALOR)
    const { name, categoryId, description, salePrice, costPrice, sizes, colors, chatbotEnabled, stockEnabled, precoPorMetro } = body

    if (!name?.trim())  return NextResponse.json({ error: "Nome é obrigatório" },       { status: 400 })
    if (!categoryId)    return NextResponse.json({ error: "Categoria é obrigatória" },  { status: 400 })

    const sizeArr  = Array.isArray(sizes)  ? sizes.filter(Boolean)  : []
    const colorArr = Array.isArray(colors) ? colors.filter(Boolean) : []

    await client.query("BEGIN")

    const { rows } = await client.query(`
      INSERT INTO products
        (name, category_id, description, sale_price, material_cost, labor_cost, additional_costs, daily_production,
         size_list, color_list, chatbot_enabled, stock_enabled, preco_por_metro)
      VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7, $8, $9, $10)
      RETURNING
        id, name,
        category_id     AS "categoryId",
        description,
        sale_price      AS "salePrice",
        material_cost   AS "costPrice",
        stock_enabled   AS "stockEnabled",
        COALESCE(preco_por_metro, false) AS "precoPorMetro",
        COALESCE(size_list, '{}')  AS sizes,
        COALESCE(color_list, '{}') AS colors,
        status,
        chatbot_enabled AS "chatbotEnabled",
        created_at      AS "createdAt"
    `, [name.trim(), categoryId, description ?? null, salePrice ?? 0, costPrice ?? 0,
        sizeArr, colorArr, chatbotEnabled ?? false, stockEnabled ?? false, precoPorMetro ?? false])

    const product = rows[0]

    if (stockEnabled) {
      await syncVariants(client, product.id, colorArr, sizeArr, salePrice ?? 0, true)
    }

    await client.query("COMMIT")
    return NextResponse.json(ocultarValores(product, await getAcesso(), CAMPOS_VALOR), { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
