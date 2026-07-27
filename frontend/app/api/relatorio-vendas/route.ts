import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    const hasDate = !!(from && to)
    const orderDateCond  = hasDate ? `AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2` : ""
    const avariDateCond  = hasDate ? `AND DATE(COALESCE(ds.resolved_at, ds.created_at) AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2` : ""
    const params = hasDate ? [from, to] : []

    // defect_stock.resolved_at/sale_price só existem depois que alguém marca uma
    // avaria como vendida pela 1a vez (criadas sob demanda em /api/defect-stock/[id])
    try {
      await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`)
      await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10,2)`)
    } catch (e) {
      console.error("[relatorio-vendas:alter-defect-stock]", e instanceof Error ? e.message : e)
    }

    // payment_method: pagamento real escolhido no PDV (pix/débito/crédito/dinheiro/prazo).
    // Sem essa coluna, o reimprimir tinha que adivinhar por heurística e podia
    // reimprimir um comprovante de cartão mostrando "Dinheiro".
    try {
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT`)
    } catch (e) {
      console.error("[relatorio-vendas:alter-orders-payment-method]", e instanceof Error ? e.message : e)
    }

    let orders: unknown[] = []
    try {
      const r = await pool.query(`
        SELECT
          o.id,
          o.number,
          o.source,
          o.status,
          o.total_value  AS "totalValue",
          o.due_date     AS "dueDate",
          o.paid_at      AS "paidAt",
          o.pix_confirmed AS "pixConfirmed",
          o.payment_method AS "paymentMethod",
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
          AND o.source IN ('pdv', 'whatsapp')
          AND o.number NOT LIKE 'COB-%'
          ${orderDateCond}
        GROUP BY o.id, c.name, c.phone
        ORDER BY o.created_at DESC
      `, params)
      orders = r.rows
    } catch (e) {
      console.error("[relatorio-vendas:orders]", e instanceof Error ? e.message : e)
      throw new Error(`orders: ${e instanceof Error ? e.message : String(e)}`)
    }

    let avarias: unknown[] = []
    try {
      const r = await pool.query(`
        SELECT
          ds.id,
          ds.product_name AS "productName",
          ds.color,
          ds.size,
          ds.qty,
          ds.notes,
          ds.sale_price                    AS "salePrice",
          COALESCE(ds.resolved_at, ds.created_at) AS "createdAt",
          o.number        AS "orderNumber"
        FROM defect_stock ds
        LEFT JOIN orders o ON o.id = ds.order_id
        WHERE ds.disposition = 'vendido'
          ${avariDateCond}
        ORDER BY COALESCE(ds.resolved_at, ds.created_at) DESC
      `, params)
      avarias = r.rows
    } catch (e) {
      console.error("[relatorio-vendas:avarias]", e instanceof Error ? e.message : e)
      throw new Error(`avarias: ${e instanceof Error ? e.message : String(e)}`)
    }

    let dtfPedidos: unknown[] = []
    try {
      const dtfDateCond = hasDate ? `AND DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2` : ""
      const r = await pool.query(`
        SELECT
          p.id,
          p.number,
          'dtf'        AS source,
          p.status,
          p.preco_cobrado AS "totalValue",
          p.due_date   AS "dueDate",
          p.concluded_at  AS "paidAt",
          p.created_at AS "createdAt",
          COALESCE(c.name, p.cliente) AS "contactName",
          c.phone      AS "contactPhone",
          json_build_array(
            json_build_object(
              'productName', 'Impressão DTF',
              'qty',         1,
              'unitPrice',   p.preco_cobrado,
              'costPrice',   NULL
            )
          ) AS items
        FROM dtf_pedidos p
        LEFT JOIN wa_contacts c ON c.id = p.contact_id
        WHERE p.status != 'cancelado'
          ${dtfDateCond}
        ORDER BY p.created_at DESC
      `, params)
      dtfPedidos = r.rows
    } catch (e) {
      console.error("[relatorio-vendas:dtf]", e instanceof Error ? e.message : e)
      throw new Error(`dtf: ${e instanceof Error ? e.message : String(e)}`)
    }

    return NextResponse.json({ orders, avarias, dtfPedidos })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[relatorio-vendas]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
