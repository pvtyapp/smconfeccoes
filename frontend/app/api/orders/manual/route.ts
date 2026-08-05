import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/orders/manual
// body: { contactId: number, items: { variantId: string, qty: number }[] }
//
// Cria pedido de produto lançado manualmente pelo operador (Gerenciador de Pedidos,
// dentro da conversa) — segue o MESMO fluxo de triagem que o chatbot usa: soma numa
// triagem aberta há menos de 2h desse contato, ou cria uma nova. Cai no mesmo kanban,
// mesmas etapas (confirmar quantidade → separação → pronto → pago/concluído).
// Só muda a origem dos itens: aqui o operador escolhe direto, sem IA interpretando texto.
export async function POST(req: Request) {
  const cli = await pool.connect()
  try {
    const { contactId, items } = await req.json() as {
      contactId: number
      items: { variantId: string; qty: number }[]
    }

    if (!contactId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "contactId e items são obrigatórios" }, { status: 400 })
    }
    if (items.some(i => !i.variantId || !i.qty || i.qty <= 0)) {
      return NextResponse.json({ error: "Cada item precisa de variantId e qty > 0" }, { status: 400 })
    }

    // Resolve dados de cada variante (nome do produto, cor, tamanho, preço de venda)
    const variantIds = items.map(i => i.variantId)
    const { rows: variantRows } = await pool.query(`
      SELECT pv.id AS "variantId", p.name AS "productName", pv.color, pv.size,
             COALESCE(pv.sale_price, p.sale_price, 0)::float AS "salePrice"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ANY($1::uuid[])
    `, [variantIds])

    if (variantRows.length !== variantIds.length) {
      return NextResponse.json({ error: "Uma ou mais variantes não foram encontradas" }, { status: 404 })
    }
    const variantMap = new Map(variantRows.map(v => [v.variantId as string, v]))

    const matched = items.map(i => {
      const v = variantMap.get(i.variantId)!
      return {
        variantId: i.variantId, qty: i.qty,
        productName: v.productName as string, color: v.color as string, size: v.size as string,
        unitPrice: v.salePrice as number,
      }
    })
    const totalValue = matched.reduce((sum, m) => sum + m.unitPrice * m.qty, 0)

    let orderId = 0
    let orderNumber = ""
    let isNewOrder = false

    await cli.query("BEGIN")
    await cli.query("SELECT pg_advisory_xact_lock($1)", [contactId])

    const { rows: openTriagem } = await cli.query(
      `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
       AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )

    if (openTriagem[0]) {
      orderId     = openTriagem[0].id as number
      orderNumber = openTriagem[0].number as string
      for (const item of matched) {
        await cli.query(
          `INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice]
        )
      }
      await cli.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [orderId]
      )
      await cli.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'triagem', 'dashboard', 'Itens adicionados manualmente pelo operador')
      `, [orderId])
    } else {
      isNewOrder = true
      const numRes = await cli.query("SELECT nextval('order_number_seq') AS n")
      const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`
      const orderRes = await cli.query(`
        INSERT INTO orders (number, contact_id, status, total_value, source)
        VALUES ($1, $2, 'triagem', $3, 'whatsapp')
        RETURNING id, number
      `, [number, contactId, totalValue > 0 ? totalValue : null])
      orderId     = orderRes.rows[0].id as number
      orderNumber = orderRes.rows[0].number as string
      for (const item of matched) {
        await cli.query(`
          INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
      }
      await cli.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'triagem', 'dashboard', 'Pedido criado manualmente pelo operador')
      `, [orderId])
      await cli.query(`
        UPDATE wa_contacts
        SET lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            last_order_at        = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [contactId])
    }

    await cli.query("COMMIT")

    // Sincroniza state do chatbot pra bater com o pedido em triagem
    await pool.query(
      `UPDATE wa_contacts SET state = 'triagem', state_data = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [contactId, JSON.stringify({ orderId, orderNumber })]
    ).catch(() => {})

    // Kanban 3 estágios: nada sai pro cliente na criação — Triagem é onde o
    // pedido é captado/alterado em silêncio. Só fala com o cliente quando o
    // operador clicar "Solicitar Confirmação" (POST /request-confirmation).

    return NextResponse.json({ ok: true, orderId, orderNumber, isNewOrder })
  } catch (err) {
    await cli.query("ROLLBACK").catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    cli.release()
  }
}
