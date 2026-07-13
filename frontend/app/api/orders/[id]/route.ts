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
      const { rows: orderRows } = await client.query(
        `SELECT status, number FROM orders WHERE id = $1`, [id]
      )
      const orderStatus = orderRows[0]?.status as string | undefined
      const orderNumber = orderRows[0]?.number as string | undefined

      // Em separação, o estoque já foi debitado com base na quantidade que existia
      // no momento da entrada no estágio. Se o operador altera a quantidade agora,
      // precisa reconciliar stock_movements pra refletir a diferença.
      let oldQtyByVariant: Record<string, number> = {}
      if (orderStatus === "em_separacao") {
        const { rows: oldItems } = await client.query(
          `SELECT variant_id, qty::int AS qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`,
          [id]
        )
        for (const r of oldItems) {
          oldQtyByVariant[r.variant_id] = (oldQtyByVariant[r.variant_id] ?? 0) + r.qty
        }
      }

      await client.query("DELETE FROM order_items WHERE order_id = $1", [id])
      for (const item of items) {
        await client.query(`
          INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, qty_confirmed, variant_id, unit_price, is_service, variant_note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          id, item.productId ?? null, item.productName, item.color ?? null, item.size ?? null, item.qty, item.qtyConfirmed ?? null,
          item.variantId ?? null, item.unitPrice ?? null, item.isService ?? false, item.variantNote ?? null,
        ])
      }
      await client.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [id]
      )

      if (orderStatus === "em_separacao") {
        const newQtyByVariant: Record<string, number> = {}
        for (const item of items) {
          if (item.variantId) newQtyByVariant[item.variantId] = (newQtyByVariant[item.variantId] ?? 0) + Number(item.qty)
        }
        const variantIds = new Set([...Object.keys(oldQtyByVariant), ...Object.keys(newQtyByVariant)])
        for (const variantId of variantIds) {
          const delta = (newQtyByVariant[variantId] ?? 0) - (oldQtyByVariant[variantId] ?? 0)
          if (delta === 0) continue
          if (delta > 0) {
            const { rows: balRows } = await client.query(
              `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS bal
               FROM stock_movements WHERE variant_id = $1`,
              [variantId]
            )
            const toDeduct = Math.min(delta, Math.max(0, balRows[0].bal))
            if (toDeduct > 0) {
              await client.query(`
                INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
                VALUES ($1, 'out', $2, 'venda', 'dashboard', $3)
              `, [variantId, toDeduct, `Ajuste Pedido ${orderNumber}`])
            }
          } else {
            await client.query(`
              INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
              VALUES ($1, 'in', $2, 'ajuste_pedido', 'dashboard', $3)
            `, [variantId, -delta, `Ajuste Pedido ${orderNumber}`])
          }
        }
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
