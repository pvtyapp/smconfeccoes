import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/clientes/[id]?days=30
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const days = parseInt(searchParams.get("days") ?? "0")

    const contactRes = await pool.query(`
      SELECT
        id, name, phone, jid,
        lifecycle_state      AS "lifecycleState",
        last_order_at        AS "lastOrderAt",
        payment_term_enabled AS "paymentTermEnabled",
        payment_term_type    AS "paymentTermType",
        payment_term_days    AS "paymentTermDays",
        created_at           AS "createdAt"
      FROM wa_contacts
      WHERE id = $1
    `, [id])

    if (!contactRes.rows[0]) {
      return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 })
    }

    const periodFilter = days > 0
      ? `AND o.created_at >= NOW() - INTERVAL '${days} days'`
      : ""

    const ordersRes = await pool.query(`
      SELECT
        o.id, o.number, o.status, o.total_value AS "totalValue",
        o.due_date AS "dueDate", o.paid_at AS "paidAt",
        o.created_at AS "createdAt",
        json_agg(
          json_build_object(
            'id', oi.id,
            'productName', oi.product_name,
            'color', oi.color,
            'size', oi.size,
            'qty', oi.qty,
            'unitPrice', oi.unit_price
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.contact_id = $1
        AND o.status != 'cancelado'
        ${periodFilter}
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [id])

    return NextResponse.json({
      contact: contactRes.rows[0],
      orders: ordersRes.rows,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PUT /api/clientes/[id] — atualiza prazo de pagamento
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { enabled, type, days } = await req.json()

    await pool.query(`
      UPDATE wa_contacts
      SET payment_term_enabled = $1,
          payment_term_type    = $2,
          payment_term_days    = $3
      WHERE id = $4
    `, [
      Boolean(enabled),
      enabled ? (type ?? null) : null,
      enabled && type === "days" ? (days ?? null) : null,
      id,
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
