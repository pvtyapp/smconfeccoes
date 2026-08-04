import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/prod-orders/[id]/print-ficha
// Marca a ficha de revisão como impressa — é o que separa "entrou" de "em
// andamento" na Costura e Revisão. Idempotente: só grava na primeira vez,
// reimprimir depois não perde a data original.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`
      UPDATE prod_orders
      SET ficha_revisao_impressa_at = COALESCE(ficha_revisao_impressa_at, NOW())
      WHERE id = $1
      RETURNING id, ficha_revisao_impressa_at AS "fichaImpressaAt"
    `, [id])

    if (!rows.length) return NextResponse.json({ error: "Ordem não encontrada" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
