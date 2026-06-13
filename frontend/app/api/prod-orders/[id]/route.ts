import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { rows: orders } = await pool.query(`
      SELECT id, number, product_id AS "productId", product_name AS "productName",
             status, cost_status AS "costStatus",
             unit_cost AS "unitCost", total_cost AS "totalCost",
             created_at AS "createdAt", concluded_at AS "concludedAt"
      FROM prod_orders WHERE id=$1
    `, [id])

    if (!orders.length) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { rows: items } = await pool.query(
      `SELECT color, size, qty_produced AS "qtyProduced" FROM prod_order_items WHERE order_id=$1 ORDER BY color,size`,
      [id]
    )

    const { rows: mats } = await pool.query(`
      SELECT
        pom.entry_id AS "entryId", rme.number AS "entryNumber",
        rme.material_id AS "materialId", rm.name AS "materialName", rm.unit,
        rme.total_qty AS "totalQty", rme.total_cost AS "totalCost",
        pom.pieces_from_entry AS "piecesFromEntry", pom.exhausted_here AS "exhaustedHere",
        rme.status AS "entryStatus"
      FROM prod_order_materials pom
      JOIN raw_material_entries rme ON rme.id = pom.entry_id
      JOIN raw_materials rm ON rm.id = rme.material_id
      WHERE pom.order_id=$1
    `, [id])

    return NextResponse.json({ ...orders[0], grade: items, materials: mats, logs: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
