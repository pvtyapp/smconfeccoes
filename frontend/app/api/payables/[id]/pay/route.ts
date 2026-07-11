import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/payables/[id]/pay — dar baixa (marca como pago)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { paidAmount } = await req.json().catch(() => ({}))

    const { rows } = await pool.query(`
      UPDATE payables SET
        paid_at     = NOW(),
        paid_amount = COALESCE($1::numeric, amount)
      WHERE id = $2
      RETURNING
        id, description, category, amount::float AS amount,
        due_date::text AS "dueDate", paid_at AS "paidAt", paid_amount::float AS "paidAmount"
    `, [paidAmount ?? null, id])

    if (!rows[0]) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
