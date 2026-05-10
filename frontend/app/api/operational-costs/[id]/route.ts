import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, category, type, monthlyValue, active, notes } = body

    const { rows } = await pool.query(`
      UPDATE operational_costs
      SET
        name          = COALESCE($1, name),
        category      = COALESCE($2, category),
        type          = COALESCE($3, type),
        monthly_value = COALESCE($4, monthly_value),
        active        = COALESCE($5, active),
        notes         = COALESCE($6, notes)
      WHERE id = $7
      RETURNING
        id, name, category, type,
        monthly_value AS "monthlyValue",
        active, notes,
        created_at    AS "createdAt"
    `, [name ?? null, category ?? null, type ?? null, monthlyValue ?? null, active ?? null, notes ?? null, id])

    if (rows.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("PUT /api/operational-costs/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query("DELETE FROM operational_costs WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("DELETE /api/operational-costs/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
