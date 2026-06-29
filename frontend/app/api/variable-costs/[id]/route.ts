import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PUT /api/variable-costs/:id
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { description, category, amount, costDate, notes } = await req.json()
    const { rows } = await pool.query(`
      UPDATE variable_costs
      SET description = COALESCE($1, description),
          category    = COALESCE($2, category),
          amount      = COALESCE($3, amount),
          cost_date   = COALESCE($4::date, cost_date),
          notes       = COALESCE($5, notes)
      WHERE id = $6
      RETURNING id, description, category, amount, cost_date::text AS "costDate", notes
    `, [description ?? null, category ?? null, amount != null ? Number(amount) : null, costDate ?? null, notes ?? null, id])
    if (rows.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/variable-costs/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await pool.query("DELETE FROM variable_costs WHERE id = $1", [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
