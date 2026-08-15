import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Modelo de kit: nome + quais produtos compõem ele (ex: "Kit Infantil" =
// Camisetas Infantil + Bermuda Infantil Moletinho). NÃO guarda cor/tamanho —
// isso é resolvido contra o catálogo de verdade na hora de montar o
// carrinho (ver app/dashboard/marketplace/page.tsx).
export async function GET() {
  try {
    const [{ rows: templates }, { rows: items }] = await Promise.all([
      pool.query(`SELECT id, nome, created_at AS "createdAt" FROM marketplace_kit_templates ORDER BY created_at DESC`),
      pool.query(`
        SELECT i.template_id AS "templateId", i.product_id AS "productId", p.name AS "productName"
        FROM marketplace_kit_template_items i
        JOIN products p ON p.id = i.product_id
      `),
    ])
    const itemsByTemplate = new Map<number, typeof items>()
    for (const it of items) {
      if (!itemsByTemplate.has(it.templateId)) itemsByTemplate.set(it.templateId, [])
      itemsByTemplate.get(it.templateId)!.push(it)
    }
    const result = templates.map(t => ({ ...t, items: itemsByTemplate.get(t.id) ?? [] }))
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { nome, productIds } = await req.json() as { nome?: string; productIds?: string[] }
    if (!nome?.trim()) return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 })
    if (!productIds || productIds.length < 2) {
      return NextResponse.json({ error: "kit precisa de pelo menos 2 produtos" }, { status: 400 })
    }

    await client.query("BEGIN")
    const { rows } = await client.query(`
      INSERT INTO marketplace_kit_templates (nome) VALUES ($1) RETURNING id, nome, created_at AS "createdAt"
    `, [nome.trim()])
    const templateId = rows[0].id

    for (const productId of productIds) {
      await client.query(`
        INSERT INTO marketplace_kit_template_items (template_id, product_id) VALUES ($1, $2)
      `, [templateId, productId])
    }
    await client.query("COMMIT")
    return NextResponse.json(rows[0])
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
