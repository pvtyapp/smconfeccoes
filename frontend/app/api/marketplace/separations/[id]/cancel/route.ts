import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Cancela/estorna uma separação — mesmo padrão do cancelamento de pedido
// (ver /api/orders/[id]/status): nunca apaga o registro, só marca
// canceled_at e devolve o estoque com um lançamento 'in' compensador. Trava
// contra clique duplo com FOR UPDATE + checagem de canceled_at na mesma
// transação (serializa concorrência em vez de confiar só no clique único).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
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
      return NextResponse.json({ error: "Essa separação já foi cancelada" }, { status: 400 })
    }
    const number = sepRows[0].number as string

    const { rows: items } = await client.query(
      `SELECT variant_id AS "variantId", qty FROM marketplace_separation_items WHERE separation_id = $1`,
      [id]
    )
    for (const it of items as { variantId: string; qty: number }[]) {
      await client.query(`
        INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
        VALUES ($1, 'in', $2, 'estorno_marketplace', 'marketplace', $3)
      `, [it.variantId, it.qty, `Estorno ${number}`])
    }

    await client.query(`UPDATE marketplace_separations SET canceled_at = now() WHERE id = $1`, [id])
    await client.query("COMMIT")
    return NextResponse.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/marketplace/separations/[id]/cancel:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
