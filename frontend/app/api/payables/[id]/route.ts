import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { description, category, amount, dueDate, notes } = await req.json()

    const { rows } = await pool.query(`
      UPDATE payables SET
        description = COALESCE($1, description),
        category    = COALESCE($2, category),
        amount      = COALESCE($3, amount),
        due_date    = COALESCE($4, due_date),
        notes       = COALESCE($5, notes)
      WHERE id = $6
      RETURNING
        id, description, category, amount::float AS amount,
        due_date::text AS "dueDate", paid_at AS "paidAt", paid_amount::float AS "paidAmount",
        notes, created_by AS "createdBy", created_at AS "createdAt"
    `, [description ?? null, category ?? null, amount ? Number(amount) : null, dueDate ?? null, notes ?? null, id])

    if (!rows[0]) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query(`DELETE FROM payables WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
