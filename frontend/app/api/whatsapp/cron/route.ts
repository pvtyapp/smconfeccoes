import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { todayBR, fmtDateOnlyBR, isWeekendBR } from "@/lib/tz"
import { runMediaCleanup } from "@/lib/blob-cleanup"
import { notifySubscribers } from "@/lib/notifications/notifySubscribers"
import { getProvider } from "@/lib/whatsapp/provider"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelay = () => sleep(3000 + Math.random() * 5000) // 3–8s anti-ban

// Vercel Cron: 0 12 * * * (09h Brasília = 12h UTC)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results: { novo: number; ausente: number; frio: number; cobranca: number; cobrancaVencida: number; stuck: number; errors: number; mediaCleared: number; messagesDeleted: number; dtfAttachmentsCleared: number; evoRestarted?: boolean; payablesDue?: number } = { novo: 0, ausente: 0, frio: 0, cobranca: 0, cobrancaVencida: 0, stuck: 0, errors: 0, mediaCleared: 0, messagesDeleted: 0, dtfAttachmentsCleared: 0 }

  // ── 0. Evolution health watchdog ────────────────────────────────────────────────
  // Only restarts on recoverable states ("close"). Skips "connecting" (reconnection
  // in progress), "qr" and "banned" (require manual intervention). Throttled to 2h
  // to avoid restart loops after a WhatsApp session ban.
  try {
    const EVO_INST = (process.env.EVOLUTION_INSTANCE ?? "").trim()
    if (EVO_INST) {
      const provider = await getProvider()
      const { state, ok } = await provider.getConnectionState(EVO_INST, 5_000)
      if (ok) {
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
              await provider.restartInstance(EVO_INST)
                .catch(e => console.error("[cron] falha ao reiniciar Evolution:", e instanceof Error ? e.message : e))
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
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_marketing_sent_at TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS marketing_optout BOOLEAN DEFAULT FALSE`).catch(() => {})
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})

  const settingsRes = await pool.query("SELECT key, value FROM app_settings")
  const s: Record<string, string> = {}
  for (const row of settingsRes.rows) s[row.key] = row.value

  const chatbotAtivo  = s.chatbot_ativo !== "false"
  const lifecycleActive = s.lifecycle_ativo !== "false"

  function t(template: string, name: string) {
    return (template || "").replace(/\{nome\}/gi, name.split(" ")[0])
  }

  const today = todayBR()
  // Cobrança de cliente (seções 7, 8, 8b) só dispara em dia útil (seg-sex).
  // Pedido vencido no fim de semana não fica sem aviso: cai pra seção 8b
  // (due_date < hoje) assim que o cron rodar na segunda-feira seguinte.
  const cobrancaHabilitada = !isWeekendBR()

  if (chatbotAtivo && lifecycleActive) {
  // ── 1. Novo D2 — lead que não converteu em 48h ────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name, jid AS send_jid FROM wa_contacts
      WHERE lifecycle_state = 'new'
      AND linked_user_id IS NULL
        AND COALESCE(novo_seq, 0) = 0
        AND state = 'idle'
        AND created_at < NOW() - INTERVAL '2 days'
        AND NOT COALESCE(marketing_optout, false)
        AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
      LIMIT 3
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`
          UPDATE wa_contacts
          SET novo_seq = 1, novo_last_sent_at = NOW(), last_marketing_sent_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [c.id])
        {
          const msg = t(
            s.novo_d2_msg || "Oi {nome}! Quando quiser fazer um pedido é só me chamar — produto, cor e tamanho que eu registro na hora.",
            c.name
          )
          const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
          await cli.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
             VALUES ($1, $2, 'out', $3, NOW())
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [c.id, result?.key?.id ?? null, msg]
          )
        }
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D2')`, [c.id]).catch(() => {})
        results.novo++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
      await randDelay()
    }
  } catch { results.errors++ }

  // ── 2. Novo → Frio (sem resposta por 7 dias após D2) ─────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id FROM wa_contacts
      WHERE lifecycle_state = 'new'
      AND linked_user_id IS NULL
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
      SELECT id, jid, name, jid AS send_jid FROM wa_contacts
      WHERE lifecycle_state = 'active'
      AND linked_user_id IS NULL
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '15 days'
        AND state NOT IN ('coletando','aguardando_menu','aguardando_cliente_1',
                          'dtf_verificando','dtf_coletando','cross_sell_dtf','cross_sell_produto')
        AND NOT COALESCE(marketing_optout, false)
        AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
      LIMIT 3
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`
          UPDATE wa_contacts
          SET lifecycle_state = 'ausente', lifecycle_updated_at = NOW(),
              ausente_seq = 1, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW()
          WHERE id = $1
        `, [c.id])
        {
          const msg = t(
            s.ausente_d15_msg || "Oi {nome}, faz um tempo! Estoque renovado aqui. Quando quiser pedir é só chamar.",
            c.name
          )
          const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
          await cli.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
             VALUES ($1, $2, 'out', $3, NOW())
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [c.id, result?.key?.id ?? null, msg]
          )
        }
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D15')`, [c.id]).catch(() => {})
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
      await randDelay()
    }
  } catch { results.errors++ }

  // ── 4. Ausente D30 ────────────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name, jid AS send_jid FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
      AND linked_user_id IS NULL
        AND ausente_seq = 1
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '30 days'
        AND NOT COALESCE(marketing_optout, false)
        AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
      LIMIT 3
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`UPDATE wa_contacts SET ausente_seq = 2, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW() WHERE id = $1`, [c.id])
        {
          const msg = t(
            s.ausente_d30_msg || "{nome}, chegaram peças novas esse mês. Me chama quando precisar.",
            c.name
          )
          const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
          await cli.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
             VALUES ($1, $2, 'out', $3, NOW())
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [c.id, result?.key?.id ?? null, msg]
          )
        }
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D30')`, [c.id]).catch(() => {})
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
      await randDelay()
    }
  } catch { results.errors++ }

  // ── 5. Ausente D45 (última mensagem) ─────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id, jid, name, jid AS send_jid FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
      AND linked_user_id IS NULL
        AND ausente_seq = 2
        AND last_order_at IS NOT NULL
        AND last_order_at < NOW() - INTERVAL '45 days'
        AND NOT COALESCE(marketing_optout, false)
        AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
      LIMIT 3
    `)
    for (const c of rows.rows) {
      const cli = await pool.connect()
      try {
        await cli.query("BEGIN")
        await cli.query(`UPDATE wa_contacts SET ausente_seq = 3, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW() WHERE id = $1`, [c.id])
        {
          const msg = t(
            s.ausente_d45_msg || "Oi {nome}! Uma última mensagem — quando precisar de estoque, pode contar comigo.",
            c.name
          )
          const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
          await cli.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
             VALUES ($1, $2, 'out', $3, NOW())
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [c.id, result?.key?.id ?? null, msg]
          )
        }
        await cli.query("COMMIT")
        await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D45')`, [c.id]).catch(() => {})
        results.ausente++
      } catch {
        await cli.query("ROLLBACK").catch(() => {})
        results.errors++
      } finally {
        cli.release()
      }
      await randDelay()
    }
  } catch { results.errors++ }

  // ── 6. Ausente → Frio (30 dias após D45 sem resposta) ────────────────────────
  try {
    const rows = await pool.query(`
      SELECT id FROM wa_contacts
      WHERE lifecycle_state = 'ausente'
      AND linked_user_id IS NULL
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

  if (cobrancaHabilitada) {
  // ── 7. Cobrança dias corridos ─────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT o.id, o.number, o.total_value, c.id AS "contactId", c.jid, c.name, c.jid AS send_jid
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
        await sendAndSave(row.contactId as number, row.send_jid as string, `Oi ${firstName}, o pagamento do pedido *${row.number}* vence hoje — *${total}*. Qualquer dúvida é só chamar!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 8. Cobrança data fixa ─────────────────────────────────────────────────────
  try {
    const rows = await pool.query(`
      SELECT c.id AS "contactId", c.jid, c.name, c.jid AS send_jid,
             array_agg(o.number ORDER BY o.created_at) AS numbers,
             SUM(o.total_value) AS total_sum
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date = $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND c.payment_term_enabled = true
        AND c.payment_term_type = 'fixed_date'
      GROUP BY c.id, c.jid, c.name, c.phone_jid
    `, [today])
    for (const row of rows.rows) {
      try {
        const firstName = (row.name as string).split(" ")[0]
        const nums = (row.numbers as string[]).join(", ")
        const total = row.total_sum ? `R$ ${Number(row.total_sum).toFixed(2)}` : "o valor total"
        await sendAndSave(row.contactId as number, row.send_jid as string, `Oi ${firstName}! Os pedidos *${nums}* vencem hoje — total: *${total}*. Pode efetuar o pagamento quando puder!`)
        results.cobranca++
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  // ── 8b. Cobrança de vencido — produto + DTF, um único aviso ─────────────────
  // Diferente das seções 7/8 (aviso só no dia do vencimento, e só pra contato com
  // prazo automático configurado): esta cobre TUDO que já venceu e continua em
  // aberto — inclusive cobrança manual (Nova Cobrança) e pedido DTF, que antes
  // nunca recebiam lembrete nenhum. Dispara uma única vez, no primeiro dia útil
  // após o vencimento (last_reminder_at IS NULL) — nunca repete depois disso.
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {})
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {})
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`).catch(() => {})

    const { rows: overdueOrders } = await pool.query(`
      SELECT o.id, o.number, o.total_value, o.amount_paid, o.due_date::text AS due_date,
             o.contact_id AS "contactId", c.jid, c.name
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date < $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND o.last_reminder_at IS NULL
    `, [today])

    const { rows: overdueDtf } = await pool.query(`
      SELECT p.id, p.number, p.preco_cobrado AS total_value, p.amount_paid, p.due_date::text AS due_date,
             p.contact_id AS "contactId", c.jid, COALESCE(c.name, p.cliente) AS name
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.due_date < $1
        AND p.paid_at IS NULL
        AND p.status != 'cancelado'
        AND p.last_reminder_at IS NULL
    `, [today])

    for (const row of [...overdueOrders, ...overdueDtf]) {
      if (!row.jid || !row.name) continue
      try {
        const total     = row.total_value != null ? Number(row.total_value) : null
        const paid      = Number(row.amount_paid ?? 0)
        const remaining = total != null ? Math.max(0, total - paid) : null
        const restanteTxt = remaining != null ? `R$ ${remaining.toFixed(2).replace(".", ",")}` : "o valor combinado"
        const firstName = (row.name as string).split(" ")[0]
        const vencTxt = row.due_date ? fmtDateOnlyBR(row.due_date) : ""
        const msg = `⚠️ Oi ${firstName}, o pagamento do pedido *${row.number}* venceu em *${vencTxt}* e continua em aberto — restam *${restanteTxt}*. Qualquer dúvida é só chamar!`
        await sendAndSave(row.contactId as number, row.jid as string, msg)
      } catch { results.errors++ }
    }

    if (overdueOrders.length > 0) {
      await pool.query(`
        UPDATE orders SET last_reminder_at = NOW()
        WHERE id = ANY($1::int[])
      `, [overdueOrders.filter(r => r.jid && r.name).map(r => r.id)])
    }
    if (overdueDtf.length > 0) {
      await pool.query(`
        UPDATE dtf_pedidos SET last_reminder_at = NOW()
        WHERE id = ANY($1::int[])
      `, [overdueDtf.filter(r => r.jid && r.name).map(r => r.id)])
    }
    results.cobrancaVencida = overdueOrders.filter(r => r.jid && r.name).length + overdueDtf.filter(r => r.jid && r.name).length
  } catch { results.errors++ }
  } // cobrancaHabilitada

  // ── 9. Reset estados presos do chatbot (> 6h sem atualização) ───────────────
  try {
    const { rowCount } = await pool.query(`
      UPDATE wa_contacts
      SET state = 'idle', state_data = '{}', updated_at = NOW()
      WHERE state IN ('aguardando_menu','dtf_coletando','dtf_sem_arquivo','cross_sell_produto',
                      'cross_sell_dtf','aguardando_cliente_1','confirmando',
                      'aguardando_separacao_resposta','aguardando_cancelamento_resposta',
                      'aguardando_reserva_resposta')
        AND updated_at < NOW() - INTERVAL '6 hours'
    `)
    results.stuck = rowCount ?? 0
  } catch { results.errors++ }

  // ── 9b. Expira reservas sem resposta (>= reserva_expiry_hours) ───────────────
  try {
    const expiryHours = Number(s.reserva_expiry_hours ?? 4)

    // Expira reservas vencidas
    const { rows: expiredRes } = await pool.query(`
      UPDATE product_reservations
      SET status = 'expired'
      WHERE status = 'notified'
        AND notified_at < NOW() - ($1 || ' hours')::INTERVAL
      RETURNING id, variant_id, contact_id
    `, [expiryHours])

    // Para cada variante que expirou, notifica próximo da fila (FIFO)
    for (const expired of expiredRes) {
      // Reseta estado do contato que expirou (independente do state atual)
      await pool.query(`
        UPDATE wa_contacts SET state = 'idle', state_data = '{}', updated_at = NOW()
        WHERE id = $1
      `, [expired.contact_id]).catch(() => {})

      // Próximo pending para a mesma variante
      const { rows: nextRes } = await pool.query(`
        SELECT pr.id, pr.contact_id, pr.qty,
               pv.color, pv.size, p.name AS product_name,
               c.jid
        FROM product_reservations pr
        JOIN product_variants pv ON pv.id = pr.variant_id
        JOIN products p          ON p.id  = pv.product_id
        JOIN wa_contacts c       ON c.id  = pr.contact_id
        WHERE pr.variant_id = $1 AND pr.status = 'pending'
        ORDER BY pr.created_at ASC LIMIT 1
      `, [expired.variant_id])

      if (nextRes[0]?.jid) {
        const next = nextRes[0]
        const variantName = [next.product_name, next.color, next.size].filter(Boolean).join(" ")
        const newExpiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()

        await pool.query(`
          UPDATE product_reservations SET status = 'notified', notified_at = NOW(), expires_at = $1
          WHERE id = $2
        `, [newExpiresAt, next.id])

        sendAndSave(
          next.contact_id,
          next.jid,
          `🎉 *${variantName}* disponível! Você estava na lista de espera. Entre em contato para confirmar! 😊`
        ).catch(() => {})
      }
    }
  } catch (e) { console.error("[cron] reserva expiry falhou:", e instanceof Error ? e.message : e); results.errors++ }

  // ── 10. Mídia TTL 48h + evicção 500MB + delete mensagens > 14 dias ────────────
  try {
    const { mediaCleared, messagesDeleted, dtfAttachmentsCleared } = await runMediaCleanup()
    results.mediaCleared           = mediaCleared
    results.messagesDeleted        = messagesDeleted
    results.dtfAttachmentsCleared  = dtfAttachmentsCleared
  } catch { results.errors++ }

  // Nota: campanhas avulsas ("enviar agora"/agendadas) e schedules recorrentes
  // migraram pro cron dedicado /api/marketing/cron (roda a cada 5min) — aqui
  // era só 1x/dia, o que fazia qualquer horário marcado depois das 9h nunca
  // disparar e campanha agendada pra data futura nunca sair de "scheduled".

  // ── 13. Contas a Pagar — lembrete no dia do vencimento ───────────────────────
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payables (
        id SERIAL PRIMARY KEY,
        description  TEXT NOT NULL,
        category     TEXT,
        amount       NUMERIC(10,2) NOT NULL,
        due_date     DATE NOT NULL,
        paid_at      TIMESTAMPTZ,
        paid_amount  NUMERIC(10,2),
        notes        TEXT,
        created_by   TEXT NOT NULL DEFAULT 'dashboard',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})

    const { rows: due } = await pool.query(`
      SELECT description, category, amount::float AS amount
      FROM payables
      WHERE due_date = $1 AND paid_at IS NULL
      ORDER BY amount DESC
    `, [today])

    if (due.length > 0) {
      const total = due.reduce((s, p) => s + Number(p.amount), 0)
      const linhas = due.map(p => `• ${p.description}${p.category ? ` (${p.category})` : ""}: R$ ${Number(p.amount).toFixed(2).replace(".", ",")}`)
      const msg = `📅 *Contas a Pagar — vencem hoje*\n\n${linhas.join("\n")}\n\nTotal: *R$ ${total.toFixed(2).replace(".", ",")}*`
      await notifySubscribers("contas_pagar", msg)
      results.payablesDue = due.length
    }
  } catch { results.errors++ }

  // Trigger sync after lifecycle — keeps contacts, phone_jid, and names up to date
  const host = req.headers.get("host") || ""
  const proto = host.includes("localhost") ? "http" : "https"
  const syncHeaders: Record<string, string> = process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}
  waitUntil(fetch(`${proto}://${host}/api/chat/sync`, { method: "POST", headers: syncHeaders, signal: AbortSignal.timeout(25_000) }).catch(() => {}))

  return NextResponse.json({ ok: true, ...results, date: today })
}
