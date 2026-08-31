import { pool } from "@/lib/db"
import { notifySubscribers } from "@/lib/notifications/notifySubscribers"

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

    // Reivindica a ordem atomicamente — segundo clique (ou retry de rede)
    // encontra status já != 'em_andamento' e aborta sem duplicar nada.
    const { rows: claimed } = await client.query(
      `UPDATE prod_orders SET status = 'concluida' WHERE id = $1 AND status = 'em_andamento' RETURNING id`,
      [orderId]
    )
    if (!claimed.length) throw new Error("Ordem já foi concluída ou não está em andamento")

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
      // Cada bobina só deve ser creditada com as peças da COR dela, não da
      // ordem inteira (uma ordem pode ter 2+ cores, cada uma com sua própria
      // bobina). Sem cor definida no vínculo (link antigo), cai no total da
      // ordem como sempre foi.
      const { rows: pomRows } = await client.query(
        `SELECT color FROM prod_order_materials WHERE order_id = $1 AND entry_id = $2`,
        [orderId, m.entryId]
      )
      const matColor = pomRows[0]?.color as string | null | undefined
      const piecesForThis = matColor
        ? grade.filter(g => g.color === matColor).reduce((s, g) => s + (g.qty ?? 0), 0)
        : totalProduced

      await client.query(`
        UPDATE prod_order_materials
        SET pieces_from_entry = $1, exhausted_here = $2
        WHERE order_id = $3 AND entry_id = $4
      `, [piecesForThis, m.exhausted ?? false, orderId, m.entryId])

      if (m.exhausted) {
        await client.query(`
          UPDATE raw_material_entries rme
          SET
            status = 'esgotada',
            exhausted_at = NOW(),
            total_pieces_produced = total_pieces_produced + $1,
            cost_per_piece = total_cost / NULLIF(total_pieces_produced + $1, 0)
          WHERE id = $2
        `, [piecesForThis, m.entryId])
        anyCostCalculated = true
      } else {
        // Peças sempre somam na bobina, mesmo se ela já foi fechada (banner
        // "Finalizar bobina") antes dessa ordem terminar de cortar — sem essa
        // soma, peças reais somem da bobina pra sempre (era o Bug 2 da auditoria).
        // Se já estava esgotada, recalcula custo/peça agora que a bobina tem
        // mais peças contabilizadas — repara o custo em branco desse cenário.
        await client.query(`
          UPDATE raw_material_entries
          SET
            total_pieces_produced = total_pieces_produced + $1,
            status = CASE WHEN status = 'esgotada' THEN status ELSE 'usada' END,
            cost_per_piece = CASE WHEN status = 'esgotada'
              THEN total_cost / NULLIF(total_pieces_produced + $1, 0)
              ELSE cost_per_piece END
          WHERE id = $2
        `, [piecesForThis, m.entryId])
      }
    }

    if (anyCostCalculated) {
      // calculate_sku_costs recebe só material agora — Custo de Costura não
      // injeta mais automaticamente em average_cost (fica só no simulador da
      // tela de Custo Operacional; material_cost do produto é a única fonte
      // de verdade de custo por peça). Default do parâmetro de costura da
      // função é 0. Decidido com o PIV em 2026-08-31.
      await client.query("SELECT calculate_sku_costs($1)", [orderId])

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
      const colors = [...new Set(grade.map(g => g.color))].join(", ")
      notifySubscribers(
        "costura_revisao",
        `📢 Ordem *${order.number}* "${order.productName} ${colors}" para revisão, verifica no dashboard!`
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
