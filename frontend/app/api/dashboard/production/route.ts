import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/dashboard/production?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns production cost breakdown for the selected period
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start")
    const end   = searchParams.get("end")

    if (!start || !end) {
      return NextResponse.json({ error: "start e end são obrigatórios" }, { status: 400 })
    }

    // Period length (days)
    const days = Math.max(1,
      Math.round((new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86400000) + 1
    )

    // 1. Pieces produced per product in period (with size weights for op cost distribution)
    const { rows: prodRows } = await pool.query(`
      SELECT
        po.product_id        AS "productId",
        po.product_name      AS "productName",
        COUNT(DISTINCT po.id)::int AS "orderCount",
        COALESCE(SUM(poi.qty_produced), 0)::int AS "totalPieces",
        COALESCE(SUM(
          poi.qty_produced * COALESCE(
            (SELECT sw.weight FROM size_weights sw
             WHERE sw.size = poi.size
             ORDER BY sw.product_id NULLS LAST LIMIT 1),
            1.0
          )
        ), 0) AS "totalWeighted"
      FROM prod_orders po
      LEFT JOIN prod_order_items poi
        ON poi.order_id = po.id AND poi.qty_produced > 0
      WHERE po.status IN ('concluida', 'encerrada')
        AND po.concluded_at::date BETWEEN $1 AND $2
      GROUP BY po.product_id, po.product_name
      ORDER BY po.product_name
    `, [start, end])

    // 2. Material cost per product in period
    const { rows: matRows } = await pool.query(`
      SELECT
        po.product_id AS "productId",
        COALESCE(SUM(
          rme.unit_price * rme.total_qty *
          (pom.pieces_from_entry::numeric / NULLIF(rme.total_pieces_produced, 0))
        ), 0) AS "materialCost"
      FROM prod_orders po
      JOIN prod_order_materials pom ON pom.order_id = po.id
      JOIN raw_material_entries rme ON rme.id = pom.entry_id
      WHERE po.status IN ('concluida', 'encerrada')
        AND po.concluded_at::date BETWEEN $1 AND $2
      GROUP BY po.product_id
    `, [start, end])

    // 3. Avg sale price per product
    const productIds = prodRows.map(p => p.productId)
    const { rows: priceRows } = productIds.length
      ? await pool.query(`
          SELECT product_id AS "productId", AVG(sale_price) AS "avgSalePrice"
          FROM product_variants
          WHERE status = 'active' AND product_id = ANY($1)
          GROUP BY product_id
        `, [productIds])
      : { rows: [] }

    // 4. Monthly operational cost total — só Custo Fixo (aluguel/energia).
    // Custo de Costura fica de fora: o material_cost do produto já embute mão
    // de obra, somar os dois juntos dobraria o custo de costura. Mesma
    // decisão aplicada em /api/relatorio-financeiro, 2026-08-31.
    const { rows: opRows } = await pool.query(
      `SELECT COALESCE(SUM(monthly_value), 0) AS total FROM operational_costs WHERE active = true AND category = 'Custo Fixo'`
    )
    const monthlyOp     = Number(opRows[0].total)
    const totalOpForPeriod = monthlyOp * (days / 30)

    // 5. Compute totals and distribute op cost proportionally by weighted pieces
    const totalWeighted = prodRows.reduce((s, p) => s + Number(p.totalWeighted), 0)
    const matMap   = new Map(matRows.map(m => [m.productId, Number(m.materialCost)]))
    const priceMap = new Map(priceRows.map(p => [p.productId, Number(p.avgSalePrice)]))

    const byProduct = prodRows.map(p => {
      const materialCost    = matMap.get(p.productId) ?? 0
      const opCost          = totalWeighted > 0
        ? totalOpForPeriod * (Number(p.totalWeighted) / totalWeighted)
        : 0
      const totalCost       = materialCost + opCost
      const costPerPiece    = p.totalPieces > 0 ? totalCost / p.totalPieces : 0
      const avgSalePrice    = priceMap.get(p.productId) ?? 0
      const margin          = avgSalePrice > 0 && costPerPiece > 0
        ? ((avgSalePrice - costPerPiece) / avgSalePrice) * 100
        : null

      return {
        productId:       p.productId,
        productName:     p.productName,
        orderCount:      p.orderCount,
        totalPieces:     p.totalPieces,
        materialCost:    Math.round(materialCost * 100) / 100,
        operationalCost: Math.round(opCost * 100) / 100,
        totalCost:       Math.round(totalCost * 100) / 100,
        costPerPiece:    Math.round(costPerPiece * 100) / 100,
        avgSalePrice:    Math.round(avgSalePrice * 100) / 100,
        margin:          margin !== null ? Math.round(margin * 10) / 10 : null,
      }
    })

    const summary = {
      orderCount:       byProduct.reduce((s, p) => s + p.orderCount, 0),
      totalPieces:      byProduct.reduce((s, p) => s + p.totalPieces, 0),
      materialCost:     Math.round(byProduct.reduce((s, p) => s + p.materialCost, 0) * 100) / 100,
      operationalCost:  Math.round(totalOpForPeriod * 100) / 100,
      totalCost:        Math.round(byProduct.reduce((s, p) => s + p.totalCost, 0) * 100) / 100,
    }

    return NextResponse.json({ period: { start, end, days }, summary, byProduct })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
