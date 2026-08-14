import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Corrige a quantidade de um item já baixado — lança só a diferença
// (delta) como movimento de estoque, não mexe no resto da separação. Trava
// contra separação cancelada (não faz sentido editar algo já estornado) e
// contra clique duplo com FOR UPDATE.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const client = await pool.connect()
  try {
    const { id, itemId } = await params
    const { qty: newQty } = await req.json() as { qty?: number }
    if (!newQty || newQty <= 0) {
      return NextResponse.json({ error: "Quantidade inválida" }, { status: 400 })
    }

    await client.query("BEGIN")

    const { rows: sepRows } = await client.query(
      `SELECT number, canceled_at AS "canceledAt" FROM marketplace_separations WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (!sepRows.length) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Separação não encontrada" }, { status: 404 })
    }
    if (sepRows[0].canceledAt) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Separação cancelada — não dá pra editar" }, { status: 400 })
    }
    const number = sepRows[0].number as string

    const { rows: itemRows } = await client.query(
      `SELECT variant_id AS "variantId", qty FROM marketplace_separation_items WHERE id = $1 AND separation_id = $2 FOR UPDATE`,
      [itemId, id]
    )
    if (!itemRows.length) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Item não encontrado" }, { status: 404 })
    }
    const { variantId, qty: oldQty } = itemRows[0] as { variantId: string; qty: number }
    const delta = newQty - oldQty

    if (delta !== 0) {
      await client.query(`
        INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
        VALUES ($1, $2, $3, 'marketplace_separacao_ajuste', 'marketplace', $4)
      `, [variantId, delta > 0 ? "out" : "in", Math.abs(delta), `Ajuste ${number}`])
    }

    await client.query(`UPDATE marketplace_separation_items SET qty = $1 WHERE id = $2`, [newQty, itemId])
    await client.query(`UPDATE marketplace_separations SET total_pieces = total_pieces + $1 WHERE id = $2`, [delta, id])

    await client.query("COMMIT")
    return NextResponse.json({ success: true, qty: newQty })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    console.error("PUT /api/marketplace/separations/[id]/items/[itemId]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
