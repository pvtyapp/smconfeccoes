import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

// Editar pedido "em andamento" — só reduz quantidade ou remove item (nunca
// aumenta nem troca variante, pra não precisar revalidar estoque de novo).
// Só permitido em em_separacao — depois disso a equipe já pode ter começado
// a separar de verdade.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const client = await pool.connect()
  try {
    const { id } = await params
    const { items } = await req.json() as { items: { itemId: number; qty: number }[] }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 })
    }

    await client.query("BEGIN")

    const { rows: orderRows } = await client.query(
      `SELECT id, status FROM orders WHERE id = $1 AND contact_id = $2 FOR UPDATE`,
      [id, session.contactId]
    )
    const order = orderRows[0]
    if (!order) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 }) }
    if (order.status !== "em_separacao") {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Esse pedido não pode mais ser editado" }, { status: 409 })
    }

    const { rows: currentItems } = await client.query(
      `SELECT id, qty FROM order_items WHERE order_id = $1`, [id]
    )
    const currentById = new Map(currentItems.map((r) => [r.id, Number(r.qty)]))

    for (const it of items) {
      const currentQty = currentById.get(it.itemId)
      if (currentQty === undefined) continue
      if (!Number.isFinite(it.qty) || it.qty < 0 || it.qty > currentQty) {
        await client.query("ROLLBACK")
        return NextResponse.json({ error: "Só é possível diminuir a quantidade, não aumentar" }, { status: 400 })
      }
      if (it.qty === 0) {
        await client.query(`DELETE FROM order_items WHERE id = $1 AND order_id = $2`, [it.itemId, id])
      } else {
        await client.query(`UPDATE order_items SET qty = $1 WHERE id = $2 AND order_id = $3`, [it.qty, it.itemId, id])
      }
    }

    const { rows: remaining } = await client.query(`SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1`, [id])
    if (remaining[0].n === 0) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Não é possível remover todos os itens — cancele o pedido em vez disso" }, { status: 400 })
    }

    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(qty * unit_price), 0) AS total FROM order_items WHERE order_id = $1`, [id]
    )
    await client.query(`UPDATE orders SET total_value = $1 WHERE id = $2`, [totalRows[0].total, id])
    await client.query(
      `INSERT INTO order_events (order_id, status, actor, note) VALUES ($1, 'em_separacao', 'site', 'Pedido editado pelo cliente')`,
      [id]
    )

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
