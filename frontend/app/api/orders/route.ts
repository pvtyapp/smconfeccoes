import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")

    const statusFilter = status ? `WHERE o.status = $1` : ""
    const params = status ? [status] : []

    const { rows } = await pool.query(`
      SELECT
        o.id,
        o.number,
        o.status,
        o.notes,
        o.created_at   AS "createdAt",
        o.updated_at   AS "updatedAt",
        c.id           AS "contactId",
        c.name         AS "contactName",
        c.phone        AS "contactPhone",
        c.jid          AS "contactJid",
        COALESCE(
          json_agg(
            json_build_object(
              'id',           i.id,
              'productId',    i.product_id,
              'productName',  i.product_name,
              'color',        i.color,
              'size',         i.size,
              'qty',          i.qty,
              'qtyConfirmed', i.qty_confirmed
            ) ORDER BY i.id
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      LEFT JOIN order_items i ON i.order_id = o.id
      ${statusFilter}
      GROUP BY o.id, c.id
      ORDER BY o.created_at DESC
    `, params)

    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/orders:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const body = await req.json()
    const { contactId, notes, items } = body

    if (!contactId) return NextResponse.json({ error: "contactId é obrigatório" }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: "items é obrigatório" }, { status: 400 })

    await client.query("BEGIN")

    const numRes = await client.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    const orderRes = await client.query(`
      INSERT INTO orders (number, contact_id, notes)
      VALUES ($1, $2, $3)
      RETURNING id, number, status, notes, created_at AS "createdAt"
    `, [number, contactId, notes ?? null])

    const order = orderRes.rows[0]

    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, product_name, color, size, qty)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [order.id, item.productId ?? null, item.productName, item.color ?? null, item.size ?? null, item.qty])
    }

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'triagem', 'system', 'Pedido criado')
    `, [order.id])

    await client.query("COMMIT")
    return NextResponse.json(order, { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/orders:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
