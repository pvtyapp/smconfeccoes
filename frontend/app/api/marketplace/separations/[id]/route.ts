import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Detalhe de uma separação — usado pro relatório de baixas (editar
// quantidade, reimprimir a ficha com os itens de verdade).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows: sepRows } = await pool.query(`
      SELECT id, number, origin, total_items AS "totalItems", total_pieces AS "totalPieces",
             created_at AS "createdAt", canceled_at AS "canceledAt"
      FROM marketplace_separations WHERE id = $1
    `, [id])
    if (!sepRows.length) return NextResponse.json({ error: "Separação não encontrada" }, { status: 404 })

    const { rows: items } = await pool.query(`
      SELECT msi.id, msi.variant_id AS "variantId", p.name AS "productName", pv.color, pv.size, pv.sku, msi.qty
      FROM marketplace_separation_items msi
      JOIN product_variants pv ON pv.id = msi.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE msi.separation_id = $1
      ORDER BY p.name, pv.color, pv.size
    `, [id])

    return NextResponse.json({ ...sepRows[0], items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
