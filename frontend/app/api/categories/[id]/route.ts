import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: "name obrigatório" }, { status: 400 })
    const { rows } = await pool.query(
      `UPDATE categories SET name = $1 WHERE id = $2
       RETURNING id, name, parent_id AS "parentId", created_at AS "createdAt"`,
      [name.trim(), id]
    )
    if (rows.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
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
    await pool.query("DELETE FROM categories WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
