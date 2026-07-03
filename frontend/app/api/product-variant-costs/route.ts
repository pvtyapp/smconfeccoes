import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Returns accumulated average costs per SKU (product + color + size)
// Falls back to raw cost_per_piece from raw_material_entries if product_variant_costs is empty
export async function GET() {
  try {
    // Try product_variant_costs first (populated by calculate_sku_costs function)
    const { rows: pvc } = await pool.query(`
      SELECT
        pvc.id, pvc.product_id AS "productId", pvc.product_name AS "productName",
        pvc.color, pvc.size,
        pvc.avg_material    AS "avgMaterial",
        pvc.avg_sewing      AS "avgSewing",
        COALESCE(pvc.avg_operational, 0) AS "avgOperational",
        pvc.avg_total       AS "avgTotal",
        pvc.sample_count    AS "sampleCount",
        pvc.last_updated    AS "lastUpdated"
      FROM product_variant_costs pvc
      ORDER BY pvc.product_name, pvc.color, pvc.size
    `).catch(() => ({ rows: [] }))

    if (pvc.length) return NextResponse.json(pvc)

    // Fallback: derive from prod_order_items + prod_order_materials
    // Only material cost available — sewing cost not yet calculated (bobinas not exhausted)
    const { rows: fallbackRaw } = await pool.query(`
      SELECT
        po.product_id    AS "productId",
        po.product_name  AS "productName",
        poi.color, poi.size,
        rme.cost_per_piece AS "avgMaterial",
        NULL::numeric    AS "avgSewing",
        NULL::numeric    AS "avgTotal",
        SUM(poi.qty_produced)::int AS "sampleCount"
      FROM prod_order_items poi
      JOIN prod_orders po ON po.id = poi.order_id
      JOIN prod_order_materials pom ON pom.order_id = po.id
      JOIN raw_material_entries rme ON rme.id = pom.entry_id AND rme.status='esgotada'
      WHERE poi.qty_produced > 0 AND rme.cost_per_piece IS NOT NULL
      GROUP BY po.product_id, po.product_name, poi.color, poi.size, rme.cost_per_piece
      ORDER BY po.product_name, poi.color, poi.size
    `).catch(() => ({ rows: [] }))

    const fallback = fallbackRaw.map(r => ({ ...r, isFallback: true }))
    return NextResponse.json(fallback)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
