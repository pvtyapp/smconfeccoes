import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/prod-orders/[id]/revision
// body: {
//   grade: { color, size, qty, aprovadas, avarias }[]
// }
// → defect_stock records for avarias
// → stock_movements for aprovadas (if variant exists)
// → prod_order status = 'encerrada'
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }  = await params
    const { grade } = await req.json()

    if (!grade?.length) {
      return NextResponse.json({ error: "grade é obrigatório" }, { status: 400 })
    }

    // Get order info
    const { rows: orders } = await pool.query(
      `SELECT product_id AS "productId", product_name AS "productName" FROM prod_orders WHERE id=$1`,
      [id]
    )
    if (!orders.length) return NextResponse.json({ error: "Ordem não encontrada" }, { status: 404 })
    const { productId, productName } = orders[0]

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      for (const g of grade) {
        const aprovadas = g.aprovadas ?? 0
        const avarias   = g.avarias   ?? 0

        // Defect stock for avarias
        if (avarias > 0) {
          // Try to find variant
          const { rows: vRows } = await client.query(`
            SELECT id FROM product_variants
            WHERE product_id=$1 AND color=$2 AND size=$3 AND status='active'
            LIMIT 1
          `, [productId, g.color, g.size])

          await client.query(`
            INSERT INTO defect_stock
              (variant_id, product_name, color, size, qty, order_id, disposition)
            VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
          `, [vRows[0]?.id ?? null, productName, g.color, g.size, avarias, id])
        }

        // Stock movement for aprovadas
        if (aprovadas > 0) {
          const { rows: vRows } = await client.query(`
            SELECT id FROM product_variants
            WHERE product_id=$1 AND color=$2 AND size=$3 AND status='active'
            LIMIT 1
          `, [productId, g.color, g.size])

          if (vRows.length) {
            await client.query(`
              INSERT INTO stock_movements
                (variant_id, type, quantity, reason, channel)
              VALUES ($1, 'in', $2, 'producao', 'producao')
            `, [vRows[0].id, aprovadas])
          }
        }
      }

      // Create revision batch records per color
      const colorMap = new Map<string, { total: number; approved: number; defect: number }>()
      for (const g of grade) {
        const cur = colorMap.get(g.color) ?? { total: 0, approved: 0, defect: 0 }
        cur.total    += g.qty       ?? 0
        cur.approved += g.aprovadas ?? 0
        cur.defect   += g.avarias   ?? 0
        colorMap.set(g.color, cur)
      }
      for (const [color, vals] of colorMap) {
        await client.query(`
          INSERT INTO prod_revision_batches
            (order_id, color, qty_total, qty_approved, qty_defect, status, concluded_at)
          VALUES ($1, $2, $3, $4, $5, 'concluido', NOW())
          ON CONFLICT DO NOTHING
        `, [id, color, vals.total, vals.approved, vals.defect])
      }

      // Mark order as encerrada
      await client.query(
        `UPDATE prod_orders SET status='encerrada' WHERE id=$1`, [id]
      )

      await client.query("COMMIT")
      return NextResponse.json({ success: true })
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
