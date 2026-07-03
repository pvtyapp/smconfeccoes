import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    // disposition filter: "pendente" (active), "all"
    const disposition = searchParams.get("disposition") ?? "pendente"

    const { rows } = await pool.query(`
      SELECT
        ds.id,
        ds.variant_id   AS "variantId",
        ds.product_name AS "productName",
        ds.color, ds.size, ds.qty,
        ds.disposition, ds.notes,
        ds.sale_price   AS "salePrice",
        po.number       AS "orderNumber",
        ds.created_at   AS "createdAt",
        ds.resolved_at  AS "resolvedAt"
      FROM defect_stock ds
      LEFT JOIN prod_orders po ON po.id = ds.order_id
      WHERE ($1 = 'all' OR ds.disposition = $1)
      ORDER BY ds.created_at DESC
    `, [disposition])

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
