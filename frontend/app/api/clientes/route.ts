import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

function normalizePhone(raw: string): { phone: string; jid: string } {
  const digits = raw.replace(/\D/g, "")
  // Already has country code (55 + 12 or 13 digits total)
  const withCC = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`
  return { phone: withCC, jid: `${withCC}@s.whatsapp.net` }
}

export async function POST(req: Request) {
  try {
    const { name, phone } = await req.json()
    if (!phone?.trim()) return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 })

    const { phone: normalizedPhone, jid } = normalizePhone(phone.trim())

    const { rows } = await pool.query(`
      INSERT INTO wa_contacts (name, phone, jid)
      VALUES ($1, $2, $3)
      ON CONFLICT (jid) DO UPDATE SET
        name = CASE WHEN $1 IS NOT NULL AND $1 != '' THEN $1 ELSE wa_contacts.name END,
        updated_at = NOW()
      RETURNING id, name, phone, jid
    `, [name?.trim() || null, normalizedPhone, jid])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.phone_jid  AS "phoneJid",
        c.jid,
        c.lifecycle_state        AS "lifecycleState",
        c.last_order_at          AS "lastOrderAt",
        c.payment_term_enabled   AS "paymentTermEnabled",
        c.payment_term_type      AS "paymentTermType",
        c.payment_term_days      AS "paymentTermDays",
        c.preco_exclusivo                        AS "precoExclusivo",
        c.chatbot_obs                            AS "chatbotObs",
        COALESCE(c.chatbot_produto_enabled, true)  AS "chatbotProdutoEnabled",
        COALESCE(c.chatbot_dtf_enabled, false)     AS "chatbotDtfEnabled",
        c.state                                  AS "chatbotState",
        c.created_at                             AS "createdAt",
        COUNT(o.id)
          FILTER (WHERE o.status != 'cancelado')           AS "orderCount",
        COALESCE(
          SUM(o.total_value)
          FILTER (WHERE o.status != 'cancelado'), 0
        ) + COALESCE(
          SUM(dp.preco_cobrado)
          FILTER (WHERE dp.status != 'cancelado'), 0
        )                                                  AS "totalSpent"
      FROM wa_contacts c
      LEFT JOIN orders o ON o.contact_id = c.id
      LEFT JOIN dtf_pedidos dp ON dp.contact_id = c.id
      GROUP BY c.id
      ORDER BY c.last_order_at DESC NULLS LAST, c.created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
