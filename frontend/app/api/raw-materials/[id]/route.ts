import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(rme.total_qty), 0) AS "activeQty"
      FROM raw_material_entries rme
      WHERE rme.material_id = $1 AND rme.status != 'esgotada'
    `, [id])
    if (Number(rows[0].activeQty) > 0) {
      return NextResponse.json(
        { error: "Ainda há estoque ativo neste material — remova o estoque antes de excluir a categoria" },
        { status: 409 }
      )
    }

    await pool.query("UPDATE raw_materials SET status='inactive' WHERE id=$1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
