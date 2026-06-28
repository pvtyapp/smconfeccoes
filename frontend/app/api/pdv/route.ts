import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

function normalizePhone(raw: string): { phone: string; jid: string } {
  const digits = raw.replace(/\D/g, "")
  const withCC = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`
  return { phone: withCC, jid: `${withCC}@s.whatsapp.net` }
}

// GET /api/pdv — last 5 PDV orders
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.number, c.name AS "contactName"
      FROM orders o
      LEFT JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.source = 'pdv'
      ORDER BY o.id DESC
      LIMIT 5
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/pdv — atomic sale: create order + pay + stock movements
export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { contactId, newContact, items, paymentMethod, dueDate, notes } = await req.json()

    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: "items é obrigatório" }, { status: 400 })

    await client.query("BEGIN")

    // 1. Resolve contact
    let resolvedContactId: number | null = contactId ?? null

    if (!resolvedContactId && newContact?.phone) {
      const { phone: normalizedPhone, jid } = normalizePhone(String(newContact.phone).trim())
      // G4 — upsert by jid (same as /api/clientes) to avoid duplicates
      const { rows } = await client.query(`
        INSERT INTO wa_contacts (name, phone, jid)
        VALUES ($1, $2, $3)
        ON CONFLICT (jid) DO UPDATE SET
          name = CASE WHEN $1 IS NOT NULL AND $1 != '' THEN $1 ELSE wa_contacts.name END,
          updated_at = NOW()
        RETURNING id
      `, [newContact.name?.trim() || null, normalizedPhone, jid])
      resolvedContactId = rows[0].id
    }

    // Fallback: anonymous "Balcão" contact
    if (!resolvedContactId) {
      const balcao = await client.query(
        "SELECT id FROM wa_contacts WHERE phone = '00000000000' LIMIT 1"
      )
      if (balcao.rows.length > 0) {
        resolvedContactId = balcao.rows[0].id
      } else {
        const { rows } = await client.query(
          "INSERT INTO wa_contacts (name, phone) VALUES ('Balcão', '00000000000') RETURNING id"
        )
        resolvedContactId = rows[0].id
      }
    }

    // 2. Order number
    const numRes = await client.query("SELECT nextval('order_number_seq') AS n")
    const number = `PDV-${String(numRes.rows[0].n).padStart(4, "0")}`

    // 3. Total
    const total: number = items.reduce(
      (s: number, i: { qty: number; unitPrice: number }) => s + i.qty * i.unitPrice,
      0
    )

    // 3b. Stock validation — lock variants, check balance before committing sale
    const variantIds = items.filter(i => i.variantId).map(i => i.variantId as number)
    if (variantIds.length > 0) {
      await client.query(
        `SELECT id FROM product_variants WHERE id = ANY($1) FOR UPDATE`,
        [variantIds]
      )
      const balRes = await client.query<{ variant_id: number; balance: number }>(`
        SELECT variant_id,
          COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS balance
        FROM stock_movements
        WHERE variant_id = ANY($1)
        GROUP BY variant_id
      `, [variantIds])
      const bal: Record<number, number> = {}
      for (const r of balRes.rows) bal[r.variant_id] = r.balance

      const insufficient: string[] = []
      for (const item of items) {
        if (!item.variantId) continue
        const available = bal[item.variantId] ?? 0
        if (item.qty > available) {
          const label = [item.productName, item.color, item.size].filter(Boolean).join(" ")
          insufficient.push(`${label}: solicitado ${item.qty}, disponível ${available}`)
        }
      }
      if (insufficient.length > 0)
        throw new Error(`Estoque insuficiente — ${insufficient.join("; ")}`)
    }

    // 4. Create order
    const isPrazo = paymentMethod === "prazo"
    const orderRes = await client.query(`
      INSERT INTO orders (number, contact_id, notes, source, total_value, due_date, status)
      VALUES ($1, $2, $3, 'pdv', $4, $5, 'pronto')
      RETURNING id, number
    `, [number, resolvedContactId, notes || null, total, isPrazo ? (dueDate || null) : null])

    const orderId = orderRes.rows[0].id

    // 5. Order items
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_name, color, size, qty, unit_price, is_service)
        VALUES ($1, $2, $3, $4, $5, $6, false)
      `, [orderId, item.productName, item.color || null, item.size || null, item.qty, item.unitPrice ?? null])
    }

    // 6. Mark as paid unless prazo
    if (!isPrazo) {
      await client.query(
        "UPDATE orders SET paid_at = NOW(), pix_confirmed = false WHERE id = $1",
        [orderId]
      )
    }

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'pronto', 'pdv', $2)
    `, [orderId, `Venda PDV${isPrazo ? " · prazo" : " · " + paymentMethod}`])

    // 7. Stock movements
    const batchId = crypto.randomUUID()
    for (const item of items) {
      if (item.variantId) {
        await client.query(`
          INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes, batch_id)
          VALUES ($1, 'out', $2, 'venda_manual', 'pdv', $3, $4)
        `, [item.variantId, item.qty, notes || null, batchId])
      }
    }

    await client.query("COMMIT")
    return NextResponse.json({ id: orderId, number, total, paymentMethod }, { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
