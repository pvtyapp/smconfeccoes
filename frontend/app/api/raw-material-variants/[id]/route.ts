import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { minQty, autoDestock } = await req.json()
    const { rows } = await pool.query(`
      UPDATE raw_material_variants
      SET
        min_qty      = COALESCE($1, min_qty),
        auto_destock = COALESCE($2, auto_destock)
      WHERE id = $3
      RETURNING id, material_id AS "raizId", name, auto_destock AS "autoDestock", min_qty AS "minQty"
    `, [minQty ?? null, autoDestock ?? null, id])
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
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
    // Check no active lots exist
    const { rows: active } = await pool.query(`
      SELECT id FROM raw_material_entries
      WHERE variant_id = $1 AND status != 'esgotada'
    `, [id])
    if (active.length > 0) {
      return NextResponse.json(
        { error: "Variante tem lotes ativos. Esgote os lotes antes de remover." },
        { status: 409 }
      )
    }
    await pool.query("DELETE FROM raw_material_variants WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
