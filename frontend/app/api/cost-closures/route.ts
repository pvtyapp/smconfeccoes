import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/cost-closures — list all closures
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        cc.id,
        cc.period_start::text AS "periodStart",
        cc.period_end::text   AS "periodEnd",
        cc.period_days    AS "periodDays",
        cc.order_count    AS "orderCount",
        cc.total_pieces   AS "totalPieces",
        cc.total_weighted AS "totalWeighted",
        cc.total_operational AS "totalOperational",
        cc.cost_per_weight_unit AS "costPerWeightUnit",
        cc.notes,
        cc.created_at     AS "createdAt"
      FROM cost_closures cc
      ORDER BY cc.period_end DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/cost-closures — create and apply a closure
// body: { periodStart: "YYYY-MM-DD", periodEnd: "YYYY-MM-DD", notes?: string }
export async function POST(req: Request) {
  try {
    const { periodStart, periodEnd, notes } = await req.json()
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: "periodStart e periodEnd são obrigatórios" }, { status: 400 })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // 1. Fetch pending orders in period
      const { rows: orders } = await client.query(`
        SELECT po.id, po.product_id AS "productId"
        FROM prod_orders po
        WHERE po.status IN ('concluida', 'encerrada')
          AND po.cost_closure_id IS NULL
          AND (DATE(po.concluded_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2)
      `, [periodStart, periodEnd])

      if (!orders.length) {
        await client.query("ROLLBACK")
        return NextResponse.json({ error: "Nenhuma ordem pendente no período informado" }, { status: 422 })
      }

      const orderIds = orders.map(o => o.id)

      // 2. Weighted pieces for each order/size
      const { rows: weightedRows } = await client.query(`
        SELECT
          poi.order_id AS "orderId",
          po.product_id AS "productId",
          poi.color,
          poi.size,
          poi.qty_produced AS qty,
          COALESCE(
            (SELECT sw.weight FROM size_weights sw
             WHERE (sw.product_id = po.product_id OR sw.product_id IS NULL)
             AND sw.size = poi.size ORDER BY sw.product_id NULLS LAST LIMIT 1),
            1.0
          ) AS weight
        FROM prod_order_items poi
        JOIN prod_orders po ON po.id = poi.order_id
        WHERE poi.order_id = ANY($1) AND poi.qty_produced > 0
      `, [orderIds])

      const totalWeighted = weightedRows.reduce(
        (s, r) => s + Number(r.qty) * Number(r.weight), 0
      )
      const totalPieces = weightedRows.reduce((s, r) => s + Number(r.qty), 0)

      // 3. Period days and operational costs
      const d1 = new Date(periodStart + "T00:00:00Z")
      const d2 = new Date(periodEnd   + "T00:00:00Z")
      const periodDays = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)

      const { rows: opCosts } = await client.query(`
        SELECT COALESCE(SUM(monthly_value), 0) AS total
        FROM operational_costs WHERE active = true
      `)
      const monthlyTotal = Number(opCosts[0].total)
      const totalOperational = monthlyTotal * (periodDays / 30)
      const costPerWeightUnit = totalWeighted > 0 ? totalOperational / totalWeighted : 0

      // 4. Create closure record
      const { rows: closureRows } = await client.query(`
        INSERT INTO cost_closures
          (period_start, period_end, period_days, order_count, total_pieces,
           total_weighted, total_operational, cost_per_weight_unit, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        periodStart, periodEnd, periodDays, orders.length,
        totalPieces, totalWeighted, totalOperational, costPerWeightUnit,
        notes ?? null,
      ])
      const closureId = closureRows[0].id

      // 5. Aggregate product+color+size costs
      type SkuKey = string
      const skuMap = new Map<SkuKey, {
        productId: string; color: string; size: string; weight: number
      }>()
      for (const r of weightedRows) {
        const key = `${r.productId}|${r.color}|${r.size}`
        if (!skuMap.has(key)) {
          skuMap.set(key, { productId: r.productId, color: r.color, size: r.size, weight: Number(r.weight) })
        }
      }

      // 6. Update product_variant_costs and product_variants for each unique SKU
      for (const { productId, color, size, weight } of skuMap.values()) {
        const opCostPerPiece = costPerWeightUnit * weight

        await client.query(`
          UPDATE product_variant_costs
          SET
            avg_operational = $1,
            avg_total       = avg_material + $1,
            last_updated    = NOW()
          WHERE product_id = $2 AND color = $3 AND size = $4
        `, [opCostPerPiece, productId, color, size])

        await client.query(`
          UPDATE product_variants pv
          SET average_cost = pvc.avg_total
          FROM product_variant_costs pvc
          WHERE pv.product_id = pvc.product_id
            AND pvc.color = pv.color AND pvc.size = pv.size
            AND pvc.product_id = $1 AND pvc.color = $2 AND pvc.size = $3
        `, [productId, color, size])
      }

      // 7. Tag orders with closure id
      await client.query(
        `UPDATE prod_orders SET cost_closure_id = $1 WHERE id = ANY($2)`,
        [closureId, orderIds]
      )

      await client.query("COMMIT")
      return NextResponse.json({ id: closureId, orderCount: orders.length, totalPieces }, { status: 201 })
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
