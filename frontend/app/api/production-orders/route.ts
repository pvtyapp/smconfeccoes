import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        po.id,
        po.product_id           AS "productId",
        p.name                  AS "productName",
        po.fabric_kg            AS "fabricKg",
        po.fabric_cost_per_kg   AS "fabricCostPerKg",
        po.sewing_cost_per_piece AS "sewingCostPerPiece",
        po.thread_cost          AS "threadCost",
        po.packaging_cost       AS "packagingCost",
        po.other_costs          AS "otherCosts",
        po.total_quantity       AS "totalQuantity",
        po.total_cost           AS "totalCost",
        po.unit_cost            AS "unitCost",
        po.notes,
        po.created_at           AS "createdAt"
      FROM production_orders po
      LEFT JOIN products p ON p.id = po.product_id
      ORDER BY po.created_at DESC
    `)

    // Busca itens para cada ordem
    const ids = rows.map((r) => r.id)
    let items: { productionOrderId: string; variantId: string; color: string; size: string; quantity: number }[] = []
    if (ids.length > 0) {
      const { rows: iRows } = await pool.query(`
        SELECT
          poi.production_order_id AS "productionOrderId",
          poi.variant_id          AS "variantId",
          pv.color,
          pv.size,
          poi.quantity
        FROM production_order_items poi
        JOIN product_variants pv ON pv.id = poi.variant_id
        WHERE poi.production_order_id = ANY($1)
      `, [ids])
      items = iRows
    }

    const ordersWithItems = rows.map((o) => ({
      ...o,
      items: items.filter((i) => i.productionOrderId === o.id),
    }))

    return NextResponse.json(ordersWithItems)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/production-orders:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      productId, items,
      fabricKg, fabricCostPerKg, sewingCostPerPiece,
      threadCost, packagingCost, otherCosts,
      totalQuantity, totalCost, unitCost, notes,
    } = body

    if (!items?.length) {
      return NextResponse.json({ error: "Ao menos uma variação é obrigatória" }, { status: 400 })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const { rows } = await client.query(`
        INSERT INTO production_orders
          (product_id, fabric_kg, fabric_cost_per_kg, sewing_cost_per_piece,
           thread_cost, packaging_cost, other_costs, total_quantity, total_cost, unit_cost, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id, created_at AS "createdAt"
      `, [
        productId ?? null,
        fabricKg ?? 0, fabricCostPerKg ?? 0, sewingCostPerPiece ?? 0,
        threadCost ?? 0, packagingCost ?? 0, otherCosts ?? 0,
        totalQuantity ?? 0, totalCost ?? 0, unitCost ?? 0,
        notes ?? null,
      ])

      const orderId = rows[0].id
      for (const item of items) {
        await client.query(`
          INSERT INTO production_order_items (production_order_id, variant_id, quantity)
          VALUES ($1, $2, $3)
        `, [orderId, item.variantId, item.quantity])

        // Gera entrada automática no estoque
        await client.query(`
          INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, reference_type, reference_id)
          VALUES ($1, 'in', $2, 'producao', 'producao', 'production_order', $3)
        `, [item.variantId, item.quantity, orderId])
      }

      await client.query("COMMIT")
      return NextResponse.json({ id: orderId }, { status: 201 })
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/production-orders:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
