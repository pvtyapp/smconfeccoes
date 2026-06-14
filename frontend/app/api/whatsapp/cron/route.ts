import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { todayBR } from "@/lib/tz"
import { runBlobTtlCleanup } from "@/lib/blob-cleanup"

// Vercel Cron: 0 12 * * * (09h Brasília = 12h UTC)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = { novo: 0, ausente: 0, frio: 0, cobranca: 0, stuck: 0, errors: 0 }

  const settingsRes = await pool.query("SELECT key, value FROM app_settings")
  const s: Record<string, string> = {}
  for (const row of settingsRes.rows) s[row.key] = row.value

  if (s.chatbot_ativo === "false") {
    return NextResponse.json({ ok: true, skipped: "chatbot_ativo=false" })
  }

  const lifecycleActive = s.lifecycle_ativo !== "false"

  function t(template: string, name: string) {
    return (template || "").replace(/\{nome\}/g, name.split(" ")[0])
  }

  const today = todayBR()

  if (lifecycleActive) {
  // ── 1. Novo D2 — lead que não converteu em 48h ────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name FROM wa_contacts
      WHERE lifecycle_state = 'new'
        AND COALESCE(novo_seq, 0) = 0
        AND state = 'idle'
        AND created_at < NOW() - INTERVAL '2 days'
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`
          UPDATE wa_contacts
          SET novo_seq = 1, novo_last_sent_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [c.id])
        await sendWhatsApp(c.jid, t(
          s.novo_d2_msg || "Oi {nome}! Quando quiser fazer um pedido é só me chamar — produto, cor e tamanho que eu registro na hora.",
          c.name
        ))
        await cli.query("COMMIT")
        results.novo++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
    }
  } catch { results.errors++ }

  // ── 2. Novo → Frio (sem resposta por 7 dias após D2) ─────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id FROM wa_contacts
      WHERE lifecycle_state = 'new'
        AND COALESCE(novo_seq, 0) = 1
        AND state = 'idle'
        AND novo_last_sent_at < NOW() - INTERVAL '7 days'
    `)
    for (const c of rows.rows) {
      try {
        await pool.query(`UPDATE wa_contacts SET lifecycle_state = 'frio', lifecycle_updated_at = NOW() WHERE id = $1`, [c.id])
        results.frio++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 3. Ativo → Ausente D15 ────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name FROM wa_contacts
      WHERE lifecycle_state = 'active'
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '15 days'
        AND state NOT IN ('coletando','aguardando_menu','aguardando_cliente_1',
                          'dtf_verificando','dtf_coletando','cross_sell_dtf','cross_sell_produto')
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`
          UPDATE wa_contacts
          SET lifecycle_state = 'ausente', lifecycle_updated_at = NOW(),
              ausente_seq = 1, ausente_last_sent_at = NOW()
          WHERE id = $1
        `, [c.id])
        await sendWhatsApp(c.jid, t(
          s.ausente_d15_msg || "Oi {nome}, faz um tempo! Estoque renovado aqui. Quando quiser pedir é só chamar.",
          c.name
        ))
        await cli.query("COMMIT")
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
    }
  } catch { results.errors++ }

  // ── 4. Ausente D30 ────────────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 1
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '30 days'
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`UPDATE wa_contacts SET ausente_seq = 2, ausente_last_sent_at = NOW() WHERE id = $1`, [c.id])
        await sendWhatsApp(c.jid, t(
          s.ausente_d30_msg || "{nome}, chegaram peças novas esse mês. Me chama quando precisar.",
          c.name
        ))
        await cli.query("COMMIT")
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
    }
  } catch { results.errors++ }

  // ── 5. Ausente D45 (última mensagem) ─────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 2
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '45 days'
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`UPDATE wa_contacts SET ausente_seq = 3, ausente_last_sent_at = NOW() WHERE id = $1`, [c.id])
        await sendWhatsApp(c.jid, t(
          s.ausente_d45_msg || "Oi {nome}! Uma última mensagem — quando precisar de estoque, pode contar comigo.",
          c.name
        ))
        await cli.query("COMMIT")
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
    }
  } catch { results.errors++ }

  // ── 6. Ausente → Frio (30 dias após D45 sem resposta) ────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
        AND ausente_seq = 3
        AND ausente_last_sent_at < NOW() - INTERVAL '30 days'
    `)
    for (const c of rows.rows) {
      try {
        await pool.query(`UPDATE wa_contacts SET lifecycle_state = 'frio', lifecycle_updated_at = NOW() WHERE id = $1`, [c.id])
        results.frio++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }
  } // lifecycleActive

  // ── 7. Cobrança dias corridos ─────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT o.id, o.number, o.total_value, c.jid, c.name
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'days'
    `, [today])
    for (const row of rows.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const total = row.total_value ? `R$ ${Number(row.total_value).toFixed(2)}` : "o valor do pedido"
        await sendWhatsApp(row.jid, `Oi ${firstName}, o pagamento do pedido *${row.number}* vence hoje — *${total}*. Qualquer dúvida é só chamar!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 8. Cobrança data fixa ─────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT c.jid, c.name,
             array_agg(o.number ORDER BY o.created_at) AS numbers,
             SUM(o.total_value) AS total_sum
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'fixed_date'
      GROUP BY c.jid, c.name
    `, [today])
    for (const row of rows.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const nums = (row.numbers as string[]).join(", ")
        const total = row.total_sum ? `R$ ${Number(row.total_sum).toFixed(2)}` : "o valor total"
        await sendWhatsApp(row.jid, `Oi ${firstName}! Os pedidos *${nums}* vencem hoje — total: *${total}*. Pode efetuar o pagamento quando puder!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 9. Reset estados presos do chatbot (> 6h sem atualização) ───────────────
  try {
    const { rowCount } = await pool.query(`
      UPDATE wa_contacts
      SET state = 'idle', state_data = '{}', updated_at = NOW()
      WHERE state IN ('aguardando_menu','dtf_coletando','cross_sell_produto',
                      'cross_sell_dtf','aguardando_cliente_1','confirmando')
        AND updated_at < NOW() - INTERVAL '6 hours'
    `)
    results.stuck = rowCount ?? 0
  } catch { results.errors++ }

  // ── 10. Limpeza TTL de blobs de mídia ────────────────────────────────────────
  const blobCleanup = await runBlobTtlCleanup().catch(() => ({ deleted: 0 }))

  return NextResponse.json({ ok: true, ...results, blobsDeleted: blobCleanup.deleted, date: today })
}
