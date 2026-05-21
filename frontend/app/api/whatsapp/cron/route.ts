import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Vercel Cron: 0 12 * * * (09h Brasília = 12h UTC)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = { ausente: 0, curioso: 0, cobranca: 0, errors: 0 }

  // Carrega templates de mensagem
  const settingsRes = await pool.query("SELECT key, value FROM app_settings")
  const s: Record<string, string> = {}
  for (const row of settingsRes.rows) s[row.key] = row.value

  function applyTemplate(template: string, name: string) {
    return (template || "").replace("{nome}", name.split(" ")[0])
  }

  const today = new Date().toISOString().split("T")[0]

  // ── 1. Ausente D7: active → ausente ─────────────────────────────────────────
  try {
    const d7 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'active'
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '7 days'
    `)
    for (const c of d7.rows) {
      try {
        await pool.query(`
          UPDATE wa_contacts
          SET lifecycle_state = 'ausente', lifecycle_updated_at = NOW(),
              ausente_seq = 1, ausente_last_sent_at = NOW()
          WHERE id = $1
        `, [c.id])
        await sendWhatsApp(c.jid, applyTemplate(s.ausente_d7_msg, c.name))
        results.ausente++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 2. Ausente D15 ───────────────────────────────────────────────────────────
  try {
    const d15 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 1
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '15 days'
    `)
    for (const c of d15.rows) {
      try {
        await pool.query(`
          UPDATE wa_contacts SET ausente_seq = 2, ausente_last_sent_at = NOW() WHERE id = $1
        `, [c.id])
        await sendWhatsApp(c.jid, s.ausente_d15_msg || "Estamos com estoque renovado, quando precisar é só chamar.")
        results.ausente++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 3. Ausente D30 ───────────────────────────────────────────────────────────
  try {
    const d30 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 2
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '30 days'
    `)
    for (const c of d30.rows) {
      try {
        await pool.query(`
          UPDATE wa_contacts SET ausente_seq = 3, ausente_last_sent_at = NOW() WHERE id = $1
        `, [c.id])
        await sendWhatsApp(c.jid, applyTemplate(s.ausente_d30_msg, c.name))
        results.ausente++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 4. Ausente D30 repeat (a cada 30 dias enquanto ausente) ──────────────────
  try {
    const d30r = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 3
        AND ausente_last_sent_at < NOW() - INTERVAL '30 days'
    `)
    for (const c of d30r.rows) {
      try {
        await pool.query(
          "UPDATE wa_contacts SET ausente_last_sent_at = NOW() WHERE id = $1",
          [c.id]
        )
        await sendWhatsApp(c.jid, applyTemplate(s.ausente_d30_msg, c.name))
        results.ausente++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 5. Curioso C7 ────────────────────────────────────────────────────────────
  try {
    const c7 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'curioso'
        AND curioso_seq = 0
        AND curioso_started_at IS NOT NULL
        AND curioso_started_at < NOW() - INTERVAL '7 days'
    `)
    for (const c of c7.rows) {
      try {
        await pool.query("UPDATE wa_contacts SET curioso_seq = 1 WHERE id = $1", [c.id])
        await sendWhatsApp(c.jid, s.curioso_c7_msg || "Conseguiu resolver? Ainda temos aquele estoque disponível.")
        results.curioso++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 6. Curioso C14 ───────────────────────────────────────────────────────────
  try {
    const c14 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'curioso'
        AND curioso_seq = 1
        AND curioso_started_at IS NOT NULL
        AND curioso_started_at < NOW() - INTERVAL '14 days'
    `)
    for (const c of c14.rows) {
      try {
        await pool.query("UPDATE wa_contacts SET curioso_seq = 2 WHERE id = $1", [c.id])
        await sendWhatsApp(c.jid, s.curioso_c14_msg || "Esse produto tá saindo bastante, me chama antes de acabar.")
        results.curioso++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 7. Curioso C21 ───────────────────────────────────────────────────────────
  try {
    const c21 = await pool.query(`
      SELECT id, jid, name
      FROM wa_contacts
      WHERE lifecycle_state = 'curioso'
        AND curioso_seq = 2
        AND curioso_started_at IS NOT NULL
        AND curioso_started_at < NOW() - INTERVAL '21 days'
    `)
    for (const c of c21.rows) {
      try {
        await pool.query("UPDATE wa_contacts SET curioso_seq = 3 WHERE id = $1", [c.id])
        await sendWhatsApp(c.jid, s.curioso_c21_msg || "Se quiser fechar aquele pedido, pode me chamar qualquer hora.")
        results.curioso++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 8. Cobrança dias corridos — 1 msg por pedido com vencimento hoje ─────────
  try {
    const dias = await pool.query(`
      SELECT o.id, o.number, o.total_value,
             c.jid, c.name
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'days'
    `, [today])

    for (const row of dias.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const total = row.total_value ? `R$ ${Number(row.total_value).toFixed(2)}` : "o valor do pedido"
        await sendWhatsApp(
          row.jid,
          `Oi ${firstName}, o pagamento do pedido *${row.number}* vence hoje — *${total}*. Qualquer dúvida é só chamar!`
        )
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 9. Cobrança data fixa — 1 msg por cliente com total de todos os pedidos ──
  try {
    const fixos = await pool.query(`
      SELECT c.jid, c.name,
             array_agg(o.number ORDER BY o.created_at) AS numbers,
             SUM(o.total_value)                         AS total_sum
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'fixed_date'
      GROUP BY c.jid, c.name
    `, [today])

    for (const row of fixos.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const nums = (row.numbers as string[]).join(", ")
        const total = row.total_sum ? `R$ ${Number(row.total_sum).toFixed(2)}` : "o valor total"
        await sendWhatsApp(
          row.jid,
          `Oi ${firstName}! Os pedidos *${nums}* vencem hoje — total: *${total}*. Pode efetuar o pagamento quando puder!`
        )
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  return NextResponse.json({ ok: true, ...results, date: today })
}
