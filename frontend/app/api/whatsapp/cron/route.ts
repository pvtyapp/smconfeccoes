import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { todayBR } from "@/lib/tz"
import { runBlobTtlCleanup, cleanAbandonedDtfOrcamento } from "@/lib/blob-cleanup"
import { list } from "@vercel/blob"

// Vercel Cron: 0 12 * * * (09h Brasília = 12h UTC)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results: { novo: number; ausente: number; frio: number; cobranca: number; stuck: number; errors: number; textCleanup: number; dtfAbandoned: number; evoRestarted?: boolean } = { novo: 0, ausente: 0, frio: 0, cobranca: 0, stuck: 0, errors: 0, textCleanup: 0, dtfAbandoned: 0 }

  // ── 0. Evolution health watchdog ────────────────────────────────────────────────
  // Only restarts on recoverable states ("close"). Skips "connecting" (reconnection
  // in progress), "qr" and "banned" (require manual intervention). Throttled to 2h
  // to avoid restart loops after a WhatsApp session ban.
  try {
    const EVO_URL  = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
    const EVO_KEY  = (process.env.EVOLUTION_API_KEY  ?? "").trim()
    const EVO_INST = (process.env.EVOLUTION_INSTANCE ?? "").trim()
    if (EVO_URL && EVO_KEY && EVO_INST) {
      const stateRes = await fetch(`${EVO_URL}/instance/connectionState/${EVO_INST}`, {
        headers: { apikey: EVO_KEY },
        signal: AbortSignal.timeout(5_000),
      })
      if (stateRes.ok) {
        const stateData = await stateRes.json() as { instance?: { state?: string }; state?: string }
        const state = stateData?.instance?.state ?? stateData?.state
        if (state !== "open") {
          const SKIP_STATES = ["connecting", "qr", "banned", "refused"]
          if (SKIP_STATES.includes(state ?? "")) {
            console.log(`[cron] Evolution state=${state} — intervenção manual necessária, sem restart automático`)
          } else {
            // Throttle: only restart if last attempt was > 2h ago
            const { rows: tr } = await pool.query(
              `SELECT value FROM app_settings WHERE key = 'evo_last_restart'`
            ).catch(() => ({ rows: [] as { value: string }[] }))
            const lastRestart = tr[0]?.value ? new Date(tr[0].value) : null
            const minsSince   = lastRestart ? (Date.now() - lastRestart.getTime()) / 60_000 : Infinity
            if (minsSince > 120) {
              console.log(`[cron] Evolution state=${state}, reiniciando (último restart: ${lastRestart ? minsSince.toFixed(0) + "min atrás" : "nunca"})`)
              await fetch(`${EVO_URL}/instance/restart/${EVO_INST}`, {
                method: "PUT",
                headers: { apikey: EVO_KEY },
                signal: AbortSignal.timeout(10_000),
              }).catch(e => console.error("[cron] falha ao reiniciar Evolution:", e instanceof Error ? e.message : e))
              await pool.query(
                `INSERT INTO app_settings (key, value) VALUES ('evo_last_restart', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [new Date().toISOString()]
              ).catch(() => {})
              results.evoRestarted = true
            } else {
              console.log(`[cron] Evolution state=${state}, restart recente (${minsSince.toFixed(0)}min) — aguardando`)
            }
          }
        }
      }
    }
  } catch (e) { console.error("[cron] watchdog evolution falhou:", e instanceof Error ? e.message : e) }

  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS phone_jid TEXT`).catch(() => {})

  const settingsRes = await pool.query("SELECT key, value FROM app_settings")
  const s: Record<string, string> = {}
  for (const row of settingsRes.rows) s[row.key] = row.value

  if (s.chatbot_ativo === "false") {
    const host = req.headers.get("host") || ""
    const proto = host.includes("localhost") ? "http" : "https"
    waitUntil(fetch(`${proto}://${host}/api/chat/sync`, { method: "POST", signal: AbortSignal.timeout(25_000) }).catch(() => {}))
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
      SELECT id, jid, name, COALESCE(phone_jid, jid) AS send_jid FROM wa_contacts
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
        await sendWhatsApp(c.send_jid as string, t(
          s.novo_d2_msg || "Oi {nome}! Quando quiser fazer um pedido é só me chamar — produto, cor e tamanho que eu registro na hora.",
          c.name
        ))
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D2')`, [c.id]).catch(() => {})
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
      SELECT id, jid, name, COALESCE(phone_jid, jid) AS send_jid FROM wa_contacts
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
        await sendWhatsApp(c.send_jid as string, t(
          s.ausente_d15_msg || "Oi {nome}, faz um tempo! Estoque renovado aqui. Quando quiser pedir é só chamar.",
          c.name
        ))
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D15')`, [c.id]).catch(() => {})
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
      SELECT id, jid, name, COALESCE(phone_jid, jid) AS send_jid FROM wa_contacts
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
        await sendWhatsApp(c.send_jid as string, t(
          s.ausente_d30_msg || "{nome}, chegaram peças novas esse mês. Me chama quando precisar.",
          c.name
        ))
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D30')`, [c.id]).catch(() => {})
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
      SELECT id, jid, name, COALESCE(phone_jid, jid) AS send_jid FROM wa_contacts
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
        await sendWhatsApp(c.send_jid as string, t(
          s.ausente_d45_msg || "Oi {nome}! Uma última mensagem — quando precisar de estoque, pode contar comigo.",
          c.name
        ))
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D45')`, [c.id]).catch(() => {})
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
      SELECT o.id, o.number, o.total_value, c.jid, c.name, COALESCE(c.phone_jid, c.jid) AS send_jid
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
        await sendWhatsApp(row.send_jid as string, `Oi ${firstName}, o pagamento do pedido *${row.number}* vence hoje — *${total}*. Qualquer dúvida é só chamar!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 8. Cobrança data fixa ─────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT c.jid, c.name, COALESCE(c.phone_jid, c.jid) AS send_jid,
             array_agg(o.number ORDER BY o.created_at) AS numbers,
             SUM(o.total_value) AS total_sum
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'fixed_date'
      GROUP BY c.jid, c.name, c.phone_jid
    `, [today])
    for (const row of rows.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const nums = (row.numbers as string[]).join(", ")
        const total = row.total_sum ? `R$ ${Number(row.total_sum).toFixed(2)}` : "o valor total"
        await sendWhatsApp(row.send_jid as string, `Oi ${firstName}! Os pedidos *${nums}* vencem hoje — total: *${total}*. Pode efetuar o pagamento quando puder!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 9. Reset estados presos do chatbot (> 6h sem atualização) ───────────────
  try {
    const { rowCount } = await pool.query(`
      UPDATE wa_contacts
      SET state = 'idle', state_data = '{}', updated_at = NOW()
      WHERE state IN ('aguardando_menu','dtf_coletando','dtf_sem_arquivo','cross_sell_produto',
                      'cross_sell_dtf','aguardando_cliente_1','confirmando')
        AND updated_at < NOW() - INTERVAL '6 hours'
    `)
    results.stuck = rowCount ?? 0
  } catch { results.errors++ }

  // ── 10. Limpeza TTL de blobs de mídia ────────────────────────────────────────
  const blobCleanup = await runBlobTtlCleanup().catch(() => ({ deleted: 0 }))

  // ── 11. Mensagens de texto antigas (> 180 dias) de contatos inativos ──────────
  try {
    const { rows: oldMsgs } = await pool.query(`
      SELECT m.id FROM wa_messages m
      JOIN wa_contacts c ON c.id = m.contact_id
      WHERE m.media_type IS NULL
        AND m.media_url IS NULL
        AND m.created_at < NOW() - INTERVAL '180 days'
        AND (c.last_order_at IS NULL OR c.last_order_at < NOW() - INTERVAL '90 days')
      LIMIT 500
    `)
    if (oldMsgs.length) {
      await pool.query(`DELETE FROM wa_messages WHERE id = ANY($1)`, [oldMsgs.map((r: { id: number }) => r.id)])
      results.textCleanup = oldMsgs.length
    }
  } catch { results.errors++ }

  // ── 12. Blobs de pedidos DTF orcamento abandonados (> 60 dias) ────────────────
  try {
    results.dtfAbandoned = await cleanAbandonedDtfOrcamento()
  } catch { results.errors++ }

  // ── Registra uso de blob no banco para exibir no dashboard ────────────────────
  try {
    const { blobs } = await list({ limit: 1000 })
    const totalMb = blobs.reduce((s, b) => s + b.size, 0) / (1024 * 1024)
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('blob_usage_mb', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [totalMb.toFixed(1)]
    )
  } catch { /* non-fatal */ }

  // Trigger sync after lifecycle — keeps contacts, phone_jid, and names up to date
  const host = req.headers.get("host") || ""
  const proto = host.includes("localhost") ? "http" : "https"
  waitUntil(fetch(`${proto}://${host}/api/chat/sync`, { method: "POST", signal: AbortSignal.timeout(25_000) }).catch(() => {}))

  return NextResponse.json({ ok: true, ...results, blobsDeleted: blobCleanup.deleted, date: today })
}
