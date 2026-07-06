import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Retorna saldo atual + vendas 30d por variação — usado em Estoque, Metas e Dashboard
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        pv.id            AS "variantId",
        pv.product_id    AS "productId",
        p.name           AS "productName",
        pv.color,
        pv.size,
        pv.sku,
        pv.min_stock     AS "minStock",
        pv.target_stock  AS "targetStock",
        pv.sale_price    AS "salePrice",
        pv.average_cost  AS "averageCost",
        p.material_cost  AS "costPrice",
        COALESCE(bal.qty, 0)::int                                                         AS "currentStock",
        COALESCE(s30.qty, 0)::int                                                         AS "salesLast30Days",
        COALESCE(rsvd.qty_pending, 0)::int                                                AS "qtyReservedPending",
        COALESCE(rsvd.qty_notified, 0)::int                                               AS "qtyReservedNotified",
        GREATEST(0, COALESCE(bal.qty, 0) - COALESCE(locked.locked_qty, 0))::int          AS "availableStock"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN (
        SELECT variant_id,
               SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
        FROM stock_movements
        GROUP BY variant_id
      ) bal ON bal.variant_id = pv.id
      LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS qty
        FROM stock_movements
        WHERE type = 'out'
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY variant_id
      ) s30 ON s30.variant_id = pv.id
      LEFT JOIN (
        SELECT variant_id,
               SUM(qty) FILTER (WHERE status = 'pending')  AS qty_pending,
               SUM(qty) FILTER (WHERE status = 'notified') AS qty_notified
        FROM product_reservations
        WHERE status IN ('pending', 'notified')
        GROUP BY variant_id
      ) rsvd ON rsvd.variant_id = pv.id
      LEFT JOIN (
        SELECT oi.variant_id, SUM(oi.qty) AS locked_qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('triagem', 'confirmando', 'em_separacao') AND oi.variant_id IS NOT NULL
        GROUP BY oi.variant_id
      ) locked ON locked.variant_id = pv.id
      WHERE pv.status = 'active' AND p.status = 'active'
      ORDER BY p.name ASC, pv.color ASC, array_position(p.size_list, pv.size) ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/stock/balance:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
