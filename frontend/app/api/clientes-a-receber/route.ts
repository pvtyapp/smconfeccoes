import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        o.id,
        o.number,
        o.status,
        o.total_value::float  AS "totalValue",
        o.due_date::text      AS "dueDate",
        o.created_at          AS "createdAt",
        c.id                  AS "contactId",
        c.name                AS "contactName",
        c.phone               AS "contactPhone",
        COALESCE(c.phone_jid, c.jid) AS "contactJid"
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND o.due_date IS NOT NULL
      ORDER BY o.due_date ASC NULLS LAST, c.name ASC, o.created_at ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { contactId, description, totalValue, dueDate } = await req.json()

    if (!contactId)  return NextResponse.json({ error: "contactId é obrigatório" },  { status: 400 })
    if (!totalValue) return NextResponse.json({ error: "totalValue é obrigatório" }, { status: 400 })
    if (!dueDate)    return NextResponse.json({ error: "dueDate é obrigatório" },    { status: 400 })

    await client.query("BEGIN")

    const numRes = await client.query("SELECT nextval('order_number_seq') AS n")
    const number = `COB-${String(numRes.rows[0].n).padStart(4, "0")}`

    const orderRes = await client.query(`
      INSERT INTO orders (number, contact_id, notes, source, total_value, due_date, status)
      VALUES ($1, $2, $3, 'manual', $4, $5, 'pronto')
      RETURNING id, number
    `, [number, contactId, description || "Cobrança manual", Number(totalValue), dueDate])

    const orderId = orderRes.rows[0].id

    await client.query(`
      INSERT INTO order_items (order_id, product_name, qty, is_service)
      VALUES ($1, $2, 1, false)
    `, [orderId, description || "Cobrança manual"])

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'pronto', 'system', 'Cobrança manual criada pelo operador')
    `, [orderId])

    await client.query("COMMIT")
    return NextResponse.json(orderRes.rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
