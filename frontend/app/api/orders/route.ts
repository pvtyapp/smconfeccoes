import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status     = searchParams.get("status")
    const source     = searchParams.get("source")
    const activeOnly = searchParams.get("activeOnly") === "true"

    const conditions: string[] = []
    const params: unknown[] = []

    if (status)     { params.push(status); conditions.push(`o.status = $${params.length}`) }
    if (source) {
      // Aceita lista separada por vírgula (ex: "whatsapp,manual") — pedido criado
      // manualmente pelo operador precisa aparecer na mesma triagem que o do chatbot.
      const sources = source.split(",").map(s => s.trim()).filter(Boolean)
      params.push(sources)
      conditions.push(`o.source = ANY($${params.length}::text[])`)
    }
    if (activeOnly) { conditions.push(`o.status NOT IN ('concluido', 'cancelado')`) }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const { rows } = await pool.query(`
      SELECT
        o.id,
        o.number,
        o.status,
        o.source,
        o.notes,
        o.delivery_date        AS "deliveryDate",
        o.total_value          AS "totalValue",
        o.due_date             AS "dueDate",
        o.created_at           AS "createdAt",
        o.updated_at           AS "updatedAt",
        o.paid_at              AS "paidAt",
        o.needs_print          AS "needsPrint",
        o.is_partial           AS "isPartial",
        (
          SELECT oe2.note LIKE '%ajuste%'
          FROM order_events oe2
          WHERE oe2.order_id = o.id
          ORDER BY oe2.created_at DESC
          LIMIT 1
        )                      AS "needsAttention",
        c.id                   AS "contactId",
        c.name                 AS "contactName",
        c.phone                AS "contactPhone",
        c.jid                  AS "contactJid",
        c.payment_term_enabled AS "paymentTermEnabled",
        c.payment_term_type    AS "paymentTermType",
        c.payment_term_days    AS "paymentTermDays",
        COALESCE(
          json_agg(
            json_build_object(
              'id',           i.id,
              'productId',    i.product_id,
              'productName',  i.product_name,
              'color',        i.color,
              'size',         i.size,
              'qty',          i.qty::int,
              'qtyConfirmed', i.qty_confirmed,
              'isService',    i.is_service,
              'variantNote',  i.variant_note,
              'variantId',    i.variant_id,
              'unitPrice',    i.unit_price::float
            ) ORDER BY i.id
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      LEFT JOIN order_items i ON i.order_id = o.id
      ${where}
      GROUP BY o.id, c.id, c.payment_term_enabled, c.payment_term_type, c.payment_term_days
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
    const { contactId, notes, items, source, deliveryDate } = body

    if (!contactId) return NextResponse.json({ error: "contactId é obrigatório" }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: "items é obrigatório" }, { status: 400 })

    await client.query("BEGIN")

    const numRes = await client.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    const orderRes = await client.query(`
      INSERT INTO orders (number, contact_id, notes, source, delivery_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, number, status, notes, source, delivery_date AS "deliveryDate", created_at AS "createdAt"
    `, [number, contactId, notes ?? null, source ?? "whatsapp", deliveryDate ?? null])

    const order = orderRes.rows[0]

    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, is_service, variant_note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        order.id,
        item.productId ?? null,
        item.productName,
        item.color ?? null,
        item.size ?? null,
        item.qty,
        item.isService ?? false,
        item.variantNote ?? null,
      ])
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
