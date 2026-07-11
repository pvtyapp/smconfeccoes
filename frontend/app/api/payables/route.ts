import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payables (
      id SERIAL PRIMARY KEY,
      description  TEXT NOT NULL,
      category     TEXT,
      amount       NUMERIC(10,2) NOT NULL,
      due_date     DATE NOT NULL,
      paid_at      TIMESTAMPTZ,
      paid_amount  NUMERIC(10,2),
      notes        TEXT,
      created_by   TEXT NOT NULL DEFAULT 'dashboard',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {})
}

export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`
      SELECT
        id, description, category,
        amount::float       AS amount,
        due_date::text      AS "dueDate",
        paid_at             AS "paidAt",
        paid_amount::float  AS "paidAmount",
        notes, created_by   AS "createdBy",
        created_at          AS "createdAt"
      FROM payables
      ORDER BY due_date ASC, created_at ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()
    const { description, category, amount, dueDate, notes, createdBy } = await req.json()

    if (!description?.trim()) return NextResponse.json({ error: "Descrição é obrigatória" }, { status: 400 })
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: "Valor é obrigatório" }, { status: 400 })
    if (!dueDate) return NextResponse.json({ error: "Vencimento é obrigatório" }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO payables (description, category, amount, due_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id, description, category, amount::float AS amount,
        due_date::text AS "dueDate", notes, created_by AS "createdBy", created_at AS "createdAt"
    `, [description.trim(), category || null, Number(amount), dueDate, notes?.trim() || null, createdBy || "dashboard"])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
