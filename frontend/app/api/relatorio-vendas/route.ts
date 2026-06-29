import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    const hasDate = !!(from && to)
    const orderDateCond  = hasDate ? `AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2` : ""
    const avariDateCond  = hasDate ? `AND DATE(ds.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2` : ""
    const params = hasDate ? [from, to] : []

    const { rows: orders } = await pool.query(`
      SELECT
        o.id,
        o.number,
        o.source,
        o.status,
        o.total_value  AS "totalValue",
        o.due_date     AS "dueDate",
        o.paid_at      AS "paidAt",
        o.created_at   AS "createdAt",
        c.name         AS "contactName",
        c.phone        AS "contactPhone",
        json_agg(
          json_build_object(
            'productName', oi.product_name,
            'color',       oi.color,
            'size',        oi.size,
            'qty',         oi.qty,
            'unitPrice',   oi.unit_price,
            'costPrice',   p.material_cost
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN wa_contacts c ON c.id = o.contact_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT material_cost FROM products
        WHERE LOWER(name) = LOWER(oi.product_name) AND status = 'active'
        LIMIT 1
      ) p ON true
      WHERE o.status != 'cancelado'
        AND o.source IN ('pdv', 'whatsapp', 'manual')
        ${orderDateCond}
      GROUP BY o.id, c.name, c.phone
      ORDER BY o.created_at DESC
    `, params)

    const { rows: avarias } = await pool.query(`
      SELECT
        ds.id,
        ds.product_name AS "productName",
        ds.color,
        ds.size,
        ds.qty,
        ds.notes,
        ds.created_at   AS "createdAt",
        o.number        AS "orderNumber"
      FROM defect_stock ds
      LEFT JOIN orders o ON o.id = ds.order_id
      WHERE ds.disposition = 'vendido'
        ${avariDateCond}
      ORDER BY ds.created_at DESC
    `, params)

    return NextResponse.json({ orders, avarias })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
