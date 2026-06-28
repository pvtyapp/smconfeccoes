import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        sm.id,
        sm.variant_id  AS "variantId",
        pv.sku,
        pv.color,
        pv.size,
        p.name         AS "productName",
        sm.type,
        sm.quantity,
        sm.reason,
        sm.channel,
        sm.notes,
        sm.batch_id    AS "batchId",
        sm.created_at  AS "createdAt"
      FROM stock_movements sm
      JOIN product_variants pv ON pv.id = sm.variant_id
      JOIN products p ON p.id = pv.product_id
      ORDER BY sm.created_at DESC
      LIMIT 2000
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/stock/movements:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { variantId, type, quantity, reason, channel, notes, batchId } = body

    if (!variantId || !type || !quantity || !reason) {
      return NextResponse.json({ error: "variantId, type, quantity e reason são obrigatórios" }, { status: 400 })
    }
    if (!["in", "out"].includes(type)) {
      return NextResponse.json({ error: "type deve ser 'in' ou 'out'" }, { status: 400 })
    }
    if (Number(quantity) <= 0) {
      return NextResponse.json({ error: "quantity deve ser maior que 0" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes, batch_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        variant_id AS "variantId",
        type, quantity, reason, channel, notes,
        batch_id AS "batchId",
        created_at AS "createdAt"
    `, [variantId, type, Number(quantity), reason, channel ?? "manual", notes ?? null, batchId ?? null])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/stock/movements:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
