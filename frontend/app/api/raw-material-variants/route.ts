import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { materialId, name, autoDestock, minQty } = await req.json()
    if (!materialId || !name?.trim()) {
      return NextResponse.json({ error: "materialId e name são obrigatórios" }, { status: 400 })
    }
    const { rows } = await pool.query(`
      INSERT INTO raw_material_variants (material_id, name, auto_destock, min_qty)
      VALUES ($1, $2, $3, $4)
      RETURNING id, material_id AS "raizId", name, auto_destock AS "autoDestock", min_qty AS "minQty"
    `, [materialId, name.trim(), autoDestock ?? false, minQty ?? null])
    return NextResponse.json({ ...rows[0], lots: [] }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
