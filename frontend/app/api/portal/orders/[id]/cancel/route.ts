import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

// Cancelar pedido "em andamento" — sem estorno de stock_movements porque o
// site nunca debita estoque de verdade até 'concluido' (mesmo padrão do
// resto do sistema); cancelar antes disso só libera o que já estava travado
// pelo cálculo de "locked" no catálogo/checkout, nada a reverter.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { id } = await params
    const { rows } = await pool.query(
      `SELECT status FROM orders WHERE id = $1 AND contact_id = $2`, [id, session.contactId]
    )
    const order = rows[0]
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (order.status !== "em_separacao") {
      return NextResponse.json({ error: "Esse pedido não pode mais ser cancelado" }, { status: 409 })
    }

    await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [id])
    await pool.query(
      `INSERT INTO order_events (order_id, status, actor, note) VALUES ($1, 'cancelado', 'site', 'Pedido cancelado pelo cliente')`,
      [id]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
