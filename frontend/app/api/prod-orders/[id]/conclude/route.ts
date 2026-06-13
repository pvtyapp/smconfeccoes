import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/prod-orders/[id]/conclude
// body: {
//   grade: { color, size, qty }[]
//   materials: { entryId, exhausted }[]
// }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }  = await params
    const { grade, materials } = await req.json()

    if (!grade?.length) {
      return NextResponse.json({ error: "grade é obrigatório" }, { status: 400 })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Update qty_produced per grade item
      for (const g of grade) {
        await client.query(`
          UPDATE prod_order_items
          SET qty_produced = $1
          WHERE order_id = $2 AND color = $3 AND size = $4
        `, [g.qty ?? 0, id, g.color, g.size])
      }

      const totalProduced = grade.reduce((s: number, g: { qty: number }) => s + (g.qty ?? 0), 0)

      // Process materials
      let anyCostCalculated = false
      for (const m of (materials ?? [])) {
        // Update pieces_from_entry and exhausted_here
        await client.query(`
          UPDATE prod_order_materials
          SET pieces_from_entry = $1, exhausted_here = $2
          WHERE order_id = $3 AND entry_id = $4
        `, [totalProduced, m.exhausted ?? false, id, m.entryId])

        if (m.exhausted) {
          // Mark bobina as esgotada, calc cost_per_piece
          await client.query(`
            UPDATE raw_material_entries rme
            SET
              status = 'esgotada',
              exhausted_at = NOW(),
              total_pieces_produced = total_pieces_produced + $1,
              cost_per_piece = total_cost / NULLIF(total_pieces_produced + $1, 0)
            WHERE id = $2
          `, [totalProduced, m.entryId])
          anyCostCalculated = true
        } else {
          // Increment pieces_produced on bobina (still in use)
          await client.query(`
            UPDATE raw_material_entries
            SET
              status = 'usada',
              total_pieces_produced = total_pieces_produced + $1
            WHERE id = $2 AND status != 'esgotada'
          `, [totalProduced, m.entryId])
        }
      }

      // Compute SKU costs if any bobina was exhausted
      if (anyCostCalculated) {
        // Fetch monthly sewing cost from operational_costs (category contains 'costura')
        const { rows: sewRows } = await client.query(`
          SELECT COALESCE(SUM(monthly_value), 0) AS total
          FROM operational_costs
          WHERE active = true
            AND (category ILIKE '%costura%' OR category ILIKE '%mão de obra%'
                 OR category ILIKE '%salario%' OR category ILIKE '%salário%')
        `)
        // Estimate: one order = one day's work, 22 working days/month
        const monthlySewing = Number(sewRows[0].total)
        const sewingCostForOrder = monthlySewing / 22

        await client.query("SELECT calculate_sku_costs($1, $2)", [id, sewingCostForOrder])

        // Sync product_variants.average_cost from product_variant_costs.avg_total
        await client.query(`
          UPDATE product_variants pv
          SET average_cost = pvc.avg_total
          FROM product_variant_costs pvc
          JOIN prod_orders po ON po.product_id = pvc.product_id
          WHERE po.id = $1
            AND pvc.color = pv.color
            AND pvc.size  = pv.size
            AND pv.product_id = pvc.product_id
        `, [id])
      }

      // Update order status
      await client.query(`
        UPDATE prod_orders
        SET
          status       = 'concluida',
          cost_status  = $1,
          concluded_at = NOW()
        WHERE id = $2
      `, [anyCostCalculated ? 'calculado' : 'pendente', id])

      await client.query("COMMIT")
      return NextResponse.json({ success: true })
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
