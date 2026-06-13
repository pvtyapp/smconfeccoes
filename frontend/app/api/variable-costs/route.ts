import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/variable-costs?month=YYYY-MM
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const month = searchParams.get("month") // YYYY-MM

    const { rows } = month
      ? await pool.query(`
          SELECT id, description, category, amount,
                 cost_date::text AS "costDate", notes, created_at AS "createdAt"
          FROM variable_costs
          WHERE to_char(cost_date, 'YYYY-MM') = $1
          ORDER BY cost_date DESC, id DESC
        `, [month])
      : await pool.query(`
          SELECT id, description, category, amount,
                 cost_date::text AS "costDate", notes, created_at AS "createdAt"
          FROM variable_costs
          ORDER BY cost_date DESC, id DESC
          LIMIT 200
        `)

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/variable-costs
// body: { description, category, amount, costDate, notes? }
export async function POST(req: Request) {
  try {
    const { description, category, amount, costDate, notes } = await req.json()
    if (!description || !category || !amount || !costDate) {
      return NextResponse.json({ error: "description, category, amount e costDate são obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO variable_costs (description, category, amount, cost_date, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, description, category, amount, cost_date::text AS "costDate", notes
    `, [description, category, Number(amount), costDate, notes ?? null])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
