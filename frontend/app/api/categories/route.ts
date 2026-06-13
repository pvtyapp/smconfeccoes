import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, parent_id AS "parentId", created_at AS "createdAt"
      FROM categories ORDER BY name ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { name, parentId } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: "name obrigatório" }, { status: 400 })
    const { rows } = await pool.query(
      `INSERT INTO categories (name, parent_id) VALUES ($1, $2)
       RETURNING id, name, parent_id AS "parentId", created_at AS "createdAt"`,
      [name.trim(), parentId ?? null]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
