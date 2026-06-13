import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Returns raw material consumption history grouped by prod order
// Each row = one material used in one order
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        pom.id,
        po.id            AS "ordemId",
        po.product_name  AS "produtoName",
        COALESCE(po.concluded_at::date::text, po.created_at::date::text) AS date,
        rm.name          AS "insumoName",
        COALESCE(rmv.name, '') AS "varianteName",
        rm.unit,
        pom.pieces_from_entry AS pecas,
        rme.unit_price   AS "pricePer",
        rme.total_qty    AS "totalQty",
        COALESCE(rme.total_pieces_produced, 0) AS "totalPiecesProduced",
        CASE
          WHEN COALESCE(rme.total_pieces_produced, 0) > 0
          THEN ROUND((pom.pieces_from_entry::numeric / rme.total_pieces_produced) * 100, 1)
          ELSE 0
        END AS "pctBobina",
        CASE
          WHEN COALESCE(rme.total_pieces_produced, 0) > 0
          THEN ROUND(
            (pom.pieces_from_entry::numeric / rme.total_pieces_produced) * rme.total_qty,
            3
          )
          ELSE 0
        END AS "qtyUsed"
      FROM prod_order_materials pom
      JOIN prod_orders po ON po.id = pom.order_id
      JOIN raw_material_entries rme ON rme.id = pom.entry_id
      JOIN raw_materials rm ON rm.id = rme.material_id
      LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
      WHERE po.status IN ('concluida', 'encerrada')
      ORDER BY po.concluded_at DESC NULLS LAST, pom.order_id DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
