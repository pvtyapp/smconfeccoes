import { pool } from "@/lib/db"
import { notifyPageUsers } from "@/lib/notifications/notifyPageUsers"

export type ConcludeGradeItem = { color: string; size: string; qty: number }
export type ConcludeMaterial = { entryId: number; exhausted: boolean }

export type ConcludeProdOrderResult = {
  totalProduced: number
  anyCostCalculated: boolean
}

// Reporta a grade realmente cortada/produzida (parcial é normal — só os
// tamanhos que vieram são atualizados) e, pra cada lote de matéria-prima usado,
// se esgotou ou não. Se algum lote esgotou, dispara o cálculo de custo por peça
// e sincroniza o custo médio das variações do produto. Usado tanto pela tela de
// Programação de Produção quanto pelo comando "concluir ordem" do bot do
// WhatsApp — mesma lógica, sem duplicar.
export async function concludeProdOrder(
  orderId: number, grade: ConcludeGradeItem[], materials: ConcludeMaterial[]
): Promise<ConcludeProdOrderResult> {
  if (!grade?.length) throw new Error("grade é obrigatório")

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    for (const g of grade) {
      await client.query(`
        UPDATE prod_order_items
        SET qty_produced = $1
        WHERE order_id = $2 AND color = $3 AND size = $4
      `, [g.qty ?? 0, orderId, g.color, g.size])
    }

    const totalProduced = grade.reduce((s, g) => s + (g.qty ?? 0), 0)

    let anyCostCalculated = false
    for (const m of (materials ?? [])) {
      await client.query(`
        UPDATE prod_order_materials
        SET pieces_from_entry = $1, exhausted_here = $2
        WHERE order_id = $3 AND entry_id = $4
      `, [totalProduced, m.exhausted ?? false, orderId, m.entryId])

      if (m.exhausted) {
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
        await client.query(`
          UPDATE raw_material_entries
          SET
            status = 'usada',
            total_pieces_produced = total_pieces_produced + $1
          WHERE id = $2 AND status != 'esgotada'
        `, [totalProduced, m.entryId])
      }
    }

    if (anyCostCalculated) {
      const { rows: sewRows } = await client.query(`
        SELECT COALESCE(SUM(monthly_value), 0) AS total
        FROM operational_costs
        WHERE active = true AND category = 'Custo de Costura'
      `)
      const monthlySewing = Number(sewRows[0].total)

      const { rows: monthPieces } = await client.query(`
        SELECT COALESCE(SUM(poi.qty_produced), 0) AS total
        FROM prod_order_items poi
        JOIN prod_orders po ON po.id = poi.order_id
        WHERE (
          (po.status IN ('concluida', 'encerrada')
           AND DATE_TRUNC('month', po.concluded_at AT TIME ZONE 'America/Sao_Paulo')
             = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo'))
          OR po.id = $1
        )
      `, [orderId])
      const totalPiecesMonth = Number(monthPieces[0].total)

      const sewingCostForOrder = monthlySewing > 0 && totalPiecesMonth > 0
        ? (monthlySewing / totalPiecesMonth) * totalProduced
        : 0

      await client.query("SELECT calculate_sku_costs($1, $2)", [orderId, sewingCostForOrder])

      await client.query(`
        UPDATE product_variants pv
        SET average_cost = pvc.avg_total
        FROM product_variant_costs pvc
        JOIN prod_orders po ON po.product_id = pvc.product_id
        WHERE po.id = $1
          AND pvc.color = pv.color
          AND pvc.size  = pv.size
          AND pv.product_id = pvc.product_id
      `, [orderId])
    }

    const { rows: orderRows } = await client.query(`
      UPDATE prod_orders
      SET
        status       = 'concluida',
        cost_status  = $1,
        concluded_at = NOW()
      WHERE id = $2
      RETURNING number, product_name AS "productName"
    `, [anyCostCalculated ? 'calculado' : 'pendente', orderId])

    await client.query("COMMIT")

    pool.query(
      `INSERT INTO prod_order_logs (order_id, event, payload) VALUES ($1, $2, $3)`,
      [orderId, 'concluida', JSON.stringify({ totalProduced, anyCostCalculated })]
    ).catch(() => {})

    const order = orderRows[0]
    if (order) {
      notifyPageUsers(
        "/dashboard/costura-revisao",
        `📢 Ordem *${order.number}* (${order.productName}) pronta pra revisão. Confere no painel.`
      ).catch(() => {})
    }

    return { totalProduced, anyCostCalculated }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
