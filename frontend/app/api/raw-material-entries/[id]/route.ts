import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PATCH: remove estoque (manual adjustment) or mark status
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params
    const { status, notes } = await req.json()

    const { rows } = await pool.query(`
      UPDATE raw_material_entries
      SET
        status = COALESCE($1, status),
        notes  = COALESCE($2, notes)
      WHERE id = $3
      RETURNING id, number, status
    `, [status ?? null, notes ?? null, id])

    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE: only if never used in a prod_order
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows: used } = await pool.query(
      "SELECT id FROM prod_order_materials WHERE entry_id=$1 LIMIT 1", [id]
    )
    if (used.length > 0) {
      return NextResponse.json(
        { error: "Lote já foi usado em uma ordem de produção e não pode ser excluído." },
        { status: 409 }
      )
    }
    await pool.query("DELETE FROM raw_material_entries WHERE id=$1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
