import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: roda a MESMA query de estoque do mapa (com o INNER JOIN pra
// product_variants/products) e compara contra a contagem crua de stock_movements,
// pra ver se o JOIN tá derrubando linhas (variant_id órfão) silenciosamente.
export async function GET() {
  try {
    const { rows: raw } = await pool.query(`
      SELECT id, type, variant_id, created_at FROM stock_movements
      WHERE created_at >= NOW() - INTERVAL '6 hours'
      ORDER BY created_at DESC
    `)

    const { rows: joined } = await pool.query(`
      SELECT sm.id, sm.type, sm.variant_id, sm.created_at AS "createdAt",
             p.name AS "productName", pv.color, pv.size
      FROM stock_movements sm
      JOIN product_variants pv ON pv.id = sm.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE sm.created_at >= NOW() - INTERVAL '6 hours'
      ORDER BY sm.created_at DESC
    `)

    const joinedIds = new Set(joined.map(j => j.id))
    const dropped = raw.filter(r => !joinedIds.has(r.id))

    return NextResponse.json({
      ok: true,
      rawCount: raw.length,
      joinedCount: joined.length,
      droppedCount: dropped.length,
      dropped,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
