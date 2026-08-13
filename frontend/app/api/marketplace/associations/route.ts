import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Regras aprendidas: prefixo do SKU do marketplace → produto/cor do catálogo.
// Consultada primeiro em /api/marketplace/parse — só cai pra IA quando o
// prefixo é novo. Alimentada automaticamente quando o operador resolve um
// item não reconhecido na conferência (ver /api/marketplace/confirm).
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.prefix, a.color, a.origin, a.created_at AS "createdAt",
             a.product_id AS "productId", p.name AS "productName"
      FROM marketplace_sku_associations a
      JOIN products p ON p.id = a.product_id
      ORDER BY a.created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { prefix, productId, color, origin } = await req.json() as {
      prefix?: string; productId?: string; color?: string; origin?: string
    }
    if (!prefix?.trim() || !productId || !color?.trim()) {
      return NextResponse.json({ error: "prefix, productId e color são obrigatórios" }, { status: 400 })
    }
    const cleanPrefix = prefix.trim().toUpperCase()
    const { rows } = await pool.query(`
      INSERT INTO marketplace_sku_associations (prefix, product_id, color, origin)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (prefix) DO UPDATE SET product_id = $2, color = $3
      RETURNING id, prefix, color, origin, created_at AS "createdAt", product_id AS "productId"
    `, [cleanPrefix, productId, color.trim(), origin ?? "manual"])
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
