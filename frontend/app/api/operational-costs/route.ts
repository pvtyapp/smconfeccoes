import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        category,
        type,
        monthly_value AS "monthlyValue",
        active,
        notes,
        created_at    AS "createdAt"
      FROM operational_costs
      ORDER BY name ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/operational-costs:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, category, type, monthlyValue, notes } = body

    if (!name?.trim() || !category?.trim()) {
      return NextResponse.json({ error: "name e category são obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO operational_costs (name, category, type, monthly_value, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id, name, category, type,
        monthly_value AS "monthlyValue",
        active, notes,
        created_at    AS "createdAt"
    `, [name.trim(), category.trim(), type ?? "fixed", monthlyValue ?? 0, notes ?? null])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/operational-costs:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
