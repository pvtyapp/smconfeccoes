import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sizeCompare } from "@/lib/sizeOrder"

// GET /api/cost-closures/preview?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns what a closure would look like — without applying it
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start")
    const end   = searchParams.get("end")

    if (!start || !end) {
      return NextResponse.json({ error: "start e end são obrigatórios" }, { status: 400 })
    }

    // Pending orders: encerrada or concluida, no closure yet, concluded_at in period
    const { rows: orders } = await pool.query(`
      SELECT
        po.id,
        po.number,
        po.product_name AS "productName",
        po.status,
        DATE(po.concluded_at AT TIME ZONE 'America/Sao_Paulo')::text AS "concludedAt",
        COALESCE(SUM(poi.qty_produced), 0)::int AS "totalPieces"
      FROM prod_orders po
      LEFT JOIN prod_order_items poi ON poi.order_id = po.id
      WHERE po.status IN ('concluida', 'encerrada')
        AND po.cost_closure_id IS NULL
        AND (DATE(po.concluded_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2)
      GROUP BY po.id
      ORDER BY po.concluded_at ASC
    `, [start, end])

    if (!orders.length) {
      return NextResponse.json({
        orders: [], orderCount: 0, totalPieces: 0, totalWeighted: 0,
        operationalCosts: [], totalOperational: 0, periodDays: 0,
        costPerWeightUnit: 0, skuBreakdown: [], productsAffected: [],
      })
    }

    // Weighted pieces: SUM(qty_produced × size_weight) across all orders
    const orderIds = orders.map(o => o.id)
    const { rows: weightedRows } = await pool.query(`
      SELECT
        poi.order_id AS "orderId",
        poi.size,
        SUM(poi.qty_produced) AS qty,
        COALESCE(
          (SELECT sw.weight FROM size_weights sw
           WHERE (sw.product_id = po.product_id OR sw.product_id IS NULL)
           AND sw.size = poi.size ORDER BY sw.product_id NULLS LAST LIMIT 1),
          1.0
        ) AS weight
      FROM prod_order_items poi
      JOIN prod_orders po ON po.id = poi.order_id
      WHERE poi.order_id = ANY($1) AND poi.qty_produced > 0
      GROUP BY poi.order_id, poi.size, po.product_id
    `, [orderIds])

    const totalWeighted = weightedRows.reduce(
      (s, r) => s + Number(r.qty) * Number(r.weight), 0
    )
    const totalPieces = orders.reduce((s, o) => s + o.totalPieces, 0)

    // Period days
    const d1 = new Date(start + "T00:00:00Z")
    const d2 = new Date(end   + "T00:00:00Z")
    const periodDays = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)

    // Operational costs (proportional to period)
    const { rows: opCosts } = await pool.query(`
      SELECT id, name, category, monthly_value AS "monthlyValue"
      FROM operational_costs
      WHERE active = true
      ORDER BY name
    `)

    const operationalCosts = opCosts.map(c => ({
      id: c.id, name: c.name, category: c.category,
      monthlyValue: Number(c.monthlyValue),
      periodValue:  Math.round(Number(c.monthlyValue) * (periodDays / 30) * 100) / 100,
    }))
    const totalOperational = operationalCosts.reduce((s, c) => s + c.periodValue, 0)
    const costPerWeightUnit = totalWeighted > 0 ? totalOperational / totalWeighted : 0

    // SKU breakdown: unique sizes across all orders with their weight
    const sizeMap = new Map<string, number>()
    for (const r of weightedRows) {
      if (!sizeMap.has(r.size)) sizeMap.set(r.size, Number(r.weight))
    }
    const skuBreakdown = [...sizeMap.entries()]
      .sort((a, b) => sizeCompare(a[0], b[0]))
      .map(([size, weight]) => ({
        size, weight,
        costPerPiece: Math.round(costPerWeightUnit * weight * 100) / 100,
      }))

    // Products affected
    const productSet = new Map<string, string>()
    for (const o of orders) productSet.set(o.id.toString(), o.productName)
    const { rows: prodRows } = await pool.query(
      `SELECT DISTINCT product_id AS "productId", product_name AS "productName"
       FROM prod_orders WHERE id = ANY($1)`, [orderIds]
    )

    return NextResponse.json({
      orders,
      orderCount:       orders.length,
      totalPieces,
      totalWeighted:    Math.round(totalWeighted * 1000) / 1000,
      operationalCosts,
      totalOperational: Math.round(totalOperational * 100) / 100,
      periodDays,
      costPerWeightUnit: Math.round(costPerWeightUnit * 10000) / 10000,
      skuBreakdown,
      productsAffected: prodRows,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
