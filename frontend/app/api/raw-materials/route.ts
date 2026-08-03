import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    // Materials with variants — exclui os que nascem sozinhos do fluxo de
    // bobina de tecido (Programação de Produção); esses aparecem só no
    // relatório de Insumos, não aqui no cadastro manual de "outros insumos".
    const { rows: mats } = await pool.query(`
      SELECT id, name, unit, unit_price AS "unitPrice", status
      FROM raw_materials
      WHERE status = 'active' AND product_id IS NULL
      ORDER BY name ASC
    `)

    // Variants with lots per material
    const { rows: variants } = await pool.query(`
      SELECT
        rmv.id, rmv.material_id AS "raizId", rmv.name,
        rmv.auto_destock AS "autoDestock", rmv.min_qty AS "minQty"
      FROM raw_material_variants rmv
      ORDER BY rmv.material_id, rmv.id
    `)

    const { rows: lots } = await pool.query(`
      SELECT
        rme.id, rme.variant_id AS "variantId", rme.material_id AS "materialId",
        rme.number, rme.total_qty AS qty, rme.unit_price AS price,
        rme.status, rme.total_pieces_produced AS "piecesProduced",
        rme.cost_per_piece AS "costPerPiece",
        rme.created_at::date::text AS "createdAt"
      FROM raw_material_entries rme
      ORDER BY rme.created_at DESC
    `)

    const result = mats.map(m => ({
      ...m,
      autoDestock: false,
      variantes: variants
        .filter(v => v.raizId === m.id)
        .map(v => ({
          ...v,
          lots: lots.filter(l => l.variantId === v.id),
        })),
    }))

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { name, unit, unitPrice } = await req.json()
    if (!name?.trim() || !unit) {
      return NextResponse.json({ error: "name e unit são obrigatórios" }, { status: 400 })
    }
    const { rows } = await pool.query(`
      INSERT INTO raw_materials (name, unit, unit_price)
      VALUES ($1, $2, $3)
      RETURNING id, name, unit, unit_price AS "unitPrice"
    `, [name.trim(), unit, unitPrice ?? 0])
    return NextResponse.json({ ...rows[0], autoDestock: false, variantes: [] }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
