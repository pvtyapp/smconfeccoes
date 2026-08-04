import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Fecha uma bobina direto do banner de "bobina aberta" — fora do fluxo de
// concluir uma ordem específica. Não chama calculate_sku_costs: não há uma
// ordem "atual" pra distribuir custo, cada ordem que já usou essa bobina já
// recebeu sua fatia no momento em que foi concluída.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Bloqueia fechar uma bobina que ainda está em uso por ordem não concluída
    // — fechar cedo demais trava o custo/peça em branco pra sempre (peças que
    // essa ordem ainda vai produzir nunca mais entram na conta da bobina).
    const { rows: activeOrders } = await pool.query(`
      SELECT DISTINCT po.number
      FROM prod_order_materials pom
      JOIN prod_orders po ON po.id = pom.order_id
      WHERE pom.entry_id = $1 AND po.status = 'em_andamento'
    `, [id])
    if (activeOrders.length) {
      return NextResponse.json({
        error: `Em uso na ordem ${activeOrders.map(o => o.number).join(", ")} — conclua ela primeiro`,
      }, { status: 409 })
    }

    const { rows } = await pool.query(`
      UPDATE raw_material_entries
      SET status = 'esgotada',
          exhausted_at = NOW(),
          cost_per_piece = total_cost / NULLIF(total_pieces_produced, 0)
      WHERE id = $1 AND status != 'esgotada'
      RETURNING id, number, status, cost_per_piece AS "costPerPiece"
    `, [id])

    if (!rows.length) return NextResponse.json({ error: "Bobina não encontrada ou já fechada" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
