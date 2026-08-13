import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Regras aprendidas: prefixo do SKU do marketplace → produto (kind='single')
// ou lista de produtos que compõem um combo (kind='kit', ex: kit com camiseta
// + calça). Em ambos os casos a associação só marca QUAL PRODUTO — cor e
// tamanho nunca ficam fixos aqui, sempre vêm do texto da variação no picklist,
// casados contra as variantes reais de cada produto no momento do match.
// Consultada primeiro em /api/marketplace/parse — só cai pra IA quando o
// prefixo é novo.
export async function GET() {
  try {
    const [{ rows: assoc }, { rows: items }] = await Promise.all([
      pool.query(`
        SELECT a.id, a.prefix, a.origin, a.kind, a.created_at AS "createdAt",
               a.product_id AS "productId", p.name AS "productName"
        FROM marketplace_sku_associations a
        LEFT JOIN products p ON p.id = a.product_id
        ORDER BY a.created_at DESC
      `),
      pool.query(`
        SELECT i.association_id AS "associationId", i.product_id AS "productId", i.qty,
               p.name AS "productName"
        FROM marketplace_sku_association_items i
        JOIN products p ON p.id = i.product_id
      `),
    ])
    const itemsByAssoc = new Map<number, typeof items>()
    for (const it of items) {
      if (!itemsByAssoc.has(it.associationId)) itemsByAssoc.set(it.associationId, [])
      itemsByAssoc.get(it.associationId)!.push(it)
    }
    const result = assoc.map(a => ({ ...a, items: a.kind === "kit" ? (itemsByAssoc.get(a.id) ?? []) : undefined }))
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { prefix, kind, productId, items, origin } = await req.json() as {
      prefix?: string; kind?: "single" | "kit"; productId?: string
      items?: { productId: string; qty: number }[]; origin?: string
    }
    if (!prefix?.trim()) {
      return NextResponse.json({ error: "prefix é obrigatório" }, { status: 400 })
    }
    const cleanPrefix = prefix.trim().toUpperCase()
    const isKit = kind === "kit"

    if (!isKit && !productId) {
      return NextResponse.json({ error: "productId é obrigatório pra associação simples" }, { status: 400 })
    }
    if (isKit && (!items || items.length === 0)) {
      return NextResponse.json({ error: "kit precisa de pelo menos 1 peça" }, { status: 400 })
    }

    await client.query("BEGIN")

    // Recria do zero se o prefixo já existir (permite editar um kit reenviando)
    await client.query(`DELETE FROM marketplace_sku_associations WHERE prefix = $1`, [cleanPrefix])

    const { rows } = await client.query(`
      INSERT INTO marketplace_sku_associations (prefix, kind, product_id, origin)
      VALUES ($1, $2, $3, $4)
      RETURNING id, prefix, kind, origin, created_at AS "createdAt", product_id AS "productId"
    `, [cleanPrefix, isKit ? "kit" : "single", isKit ? null : productId, origin ?? "manual"])
    const assocId = rows[0].id

    if (isKit) {
      for (const it of items!) {
        if (!it.productId || !it.qty || it.qty <= 0) continue
        await client.query(`
          INSERT INTO marketplace_sku_association_items (association_id, product_id, qty)
          VALUES ($1, $2, $3)
        `, [assocId, it.productId, it.qty])
      }
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
