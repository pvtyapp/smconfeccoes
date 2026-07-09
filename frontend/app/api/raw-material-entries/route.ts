import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { createRawMaterialEntry } from "@/lib/rawMaterials/createEntry"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const materialId = searchParams.get("materialId")
    const status     = searchParams.get("status") // comma-separated: "disponivel,usada"

    const statusList = status ? status.split(",") : null

    const { rows } = await pool.query(`
      SELECT
        rme.id, rme.number,
        rme.material_id AS "materialId", rm.name AS "materialName", rm.unit,
        rme.variant_id  AS "variantId",  rmv.name AS "varianteName",
        rme.total_qty   AS "totalQty", rme.unit_price AS "unitPrice",
        rme.total_cost  AS "totalCost",
        rme.status, rme.total_pieces_produced AS "totalPiecesProduced",
        rme.cost_per_piece AS "costPerPiece",
        rme.created_at::date::text AS "createdAt"
      FROM raw_material_entries rme
      JOIN raw_materials rm ON rm.id = rme.material_id
      LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
      WHERE ($1::int IS NULL OR rme.material_id = $1)
        AND ($2::text[] IS NULL OR rme.status = ANY($2))
      ORDER BY rme.created_at DESC
    `, [materialId ?? null, statusList])

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { materialId, variantId, qty, price } = await req.json()
    const entry = await createRawMaterialEntry(materialId, variantId ?? null, qty, price ?? 0)
    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("obrigatórios") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
