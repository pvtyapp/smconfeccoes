import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

async function getOrder(id: string) {
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
            'qty',          i.qty::int,
            'qtyConfirmed', i.qty_confirmed
          ) ORDER BY i.id
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    JOIN wa_contacts c ON c.id = o.contact_id
    LEFT JOIN order_items i ON i.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id, c.id
  `, [id])
  return rows[0] ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const order = await getOrder(id)
    if (!order) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(order)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json()
    const { notes, items } = body

    await client.query("BEGIN")

    if (notes !== undefined) {
      await client.query("UPDATE orders SET notes = $1 WHERE id = $2", [notes, id])
    }

    if (Array.isArray(items)) {
      await client.query("DELETE FROM order_items WHERE order_id = $1", [id])
      for (const item of items) {
        await client.query(`
          INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, qty_confirmed)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [id, item.productId ?? null, item.productName, item.color ?? null, item.size ?? null, item.qty, item.qtyConfirmed ?? null])
      }
    }

    await client.query("COMMIT")
    const order = await getOrder(id)
    return NextResponse.json(order)
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
