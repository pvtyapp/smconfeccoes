import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { createRawMaterialEntry } from "@/lib/rawMaterials/createEntry"
import { createBobinaForColor } from "@/lib/rawMaterials/createBobinaForColor"

// Bobinas de tecido (nascidas em Programação de Produção, ligadas a um produto)
// abertas — usado tanto pro check "essa cor já tem bobina aberta?" (productId+color)
// quanto pro banner de bobinas abertas (openSummary).
async function fetchOpenBobinas(productId: string | null, color: string | null) {
  const { rows } = await pool.query(`
    SELECT
      rme.id, rme.number,
      rm.product_id AS "productId", p.name AS "productName",
      rmv.name AS "color",
      rme.tecido, rme.tipo_tecido AS "tipoTecido",
      rme.peso_kg AS "pesoKg", rme.gramatura, rme.largura_m AS "larguraM", rme.preco_kg AS "precoKg",
      rme.total_qty AS "totalQty", rme.unit_price AS "unitPrice", rme.total_cost AS "totalCost",
      rme.status, rme.created_at AS "createdAt",
      EXTRACT(DAY FROM NOW() - rme.created_at)::int AS "diasAberta",
      COALESCE(agg.ordens, 0)::int AS "ordens",
      COALESCE(agg.pecas, 0)::int AS "pecas"
    FROM raw_material_entries rme
    JOIN raw_materials rm ON rm.id = rme.material_id
    JOIN products p ON p.id = rm.product_id
    LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
    LEFT JOIN (
      SELECT entry_id, COUNT(DISTINCT order_id) AS ordens, SUM(pieces_from_entry) AS pecas
      FROM prod_order_materials GROUP BY entry_id
    ) agg ON agg.entry_id = rme.id
    WHERE rm.product_id IS NOT NULL AND rme.status != 'esgotada'
      AND ($1::int IS NULL OR rm.product_id = $1)
      AND ($2::text IS NULL OR rmv.name = $2)
    ORDER BY rme.created_at ASC
  `, [productId ?? null, color ?? null])
  return rows
}

// Bobinas de tecido já fechadas (esgotadas) num período — relatório de Insumos.
// Peças cortadas vêm por TAMANHO (join com prod_order_items pela mesma
// ordem+cor da bobina), não por número de ordem.
async function fetchClosedBobinas(days: number | null) {
  const { rows } = await pool.query(`
    SELECT
      rme.id, rme.number,
      rm.product_id AS "productId", p.name AS "productName",
      rmv.name AS "color",
      rme.tecido, rme.tipo_tecido AS "tipoTecido",
      rme.peso_kg AS "pesoKg", rme.gramatura, rme.largura_m AS "larguraM", rme.preco_kg AS "precoKg",
      rme.total_qty AS "totalQty", rme.total_cost AS "totalCost",
      rme.total_pieces_produced AS "totalPiecesProduced",
      rme.cost_per_piece AS "costPerPiece",
      rme.created_at AS "createdAt", rme.exhausted_at AS "exhaustedAt",
      COALESCE(agg.ordens, 0)::int AS "ordens",
      COALESCE(sizes.breakdown, '[]') AS "sizeBreakdown"
    FROM raw_material_entries rme
    JOIN raw_materials rm ON rm.id = rme.material_id
    JOIN products p ON p.id = rm.product_id
    LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
    LEFT JOIN (
      SELECT entry_id, COUNT(DISTINCT order_id) AS ordens
      FROM prod_order_materials GROUP BY entry_id
    ) agg ON agg.entry_id = rme.id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('size', s.size, 'qty', s.qty) ORDER BY s.size) AS breakdown
      FROM (
        SELECT poi.size, SUM(poi.qty_produced) AS qty
        FROM prod_order_materials pom
        JOIN prod_order_items poi ON poi.order_id = pom.order_id AND poi.color = pom.color
        WHERE pom.entry_id = rme.id AND poi.qty_produced > 0
        GROUP BY poi.size
      ) s
    ) sizes ON true
    WHERE rm.product_id IS NOT NULL AND rme.status = 'esgotada'
      AND ($1::int IS NULL OR rme.exhausted_at > NOW() - ($1 || ' days')::interval)
    ORDER BY rme.exhausted_at DESC
  `, [days])
  return rows
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const materialId    = searchParams.get("materialId")
    const status        = searchParams.get("status") // comma-separated: "disponivel,usada"
    const productId     = searchParams.get("productId")
    const color         = searchParams.get("color")
    const openSummary   = searchParams.get("openSummary")
    const closedSummary = searchParams.get("closedSummary")
    const days          = searchParams.get("days")

    if (closedSummary) {
      const rows = await fetchClosedBobinas(days ? Number(days) : null)
      return NextResponse.json(rows)
    }

    if (openSummary || productId) {
      const rows = await fetchOpenBobinas(productId, color)
      return NextResponse.json(rows)
    }

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
        AND rm.product_id IS NULL
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
    const body = await req.json()

    if (body.productId) {
      const entry = await createBobinaForColor({
        productId:  body.productId,
        color:      body.color,
        tecido:     body.tecido,
        tipoTecido: body.tipoTecido,
        pesoKg:     Number(body.pesoKg),
        gramatura:  Number(body.gramatura),
        larguraM:   Number(body.larguraM),
        precoKg:    Number(body.precoKg),
      })
      return NextResponse.json(entry, { status: 201 })
    }

    const { materialId, variantId, qty, price } = body
    const entry = await createRawMaterialEntry(materialId, variantId ?? null, qty, price ?? 0)
    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("obrigatórios") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
