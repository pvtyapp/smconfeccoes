import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Fecha uma bobina direto do banner de "bobina aberta" — fora do fluxo de
// concluir uma ordem específica. Não chama calculate_sku_costs: não há uma
// ordem "atual" pra distribuir custo, cada ordem que já usou essa bobina já
// recebeu sua fatia no momento em que foi concluída.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
