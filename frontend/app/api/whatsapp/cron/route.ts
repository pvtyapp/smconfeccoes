import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { todayBR, subDaysBR, fmtDateOnlyBR, isWeekendBR } from "@/lib/tz"
import { runMediaCleanup } from "@/lib/blob-cleanup"
import { sendAdministrativo } from "@/lib/whatsapp/administrativoGroup"
import { getProvider } from "@/lib/whatsapp/provider"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelayClient = () => sleep(8000 + Math.random() * 12000) // 8-20s, cliente individual — mais devagar

// Vercel Cron: 0 12 * * * (09h Brasília = 12h UTC)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results: { cobranca: number; stuck: number; errors: number; mediaCleared: number; messagesDeleted: number; dtfAttachmentsCleared: number; evolutionDeleted: number; evoRestarted?: boolean; payablesDue?: number } = { cobranca: 0, stuck: 0, errors: 0, mediaCleared: 0, messagesDeleted: 0, dtfAttachmentsCleared: 0, evolutionDeleted: 0 }

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

  const today = todayBR()
  // Disjuntor geral: além de sendAndSave() ficar mudo, essas seções também
  // precisam nem tentar rodar — sem isso, last_reminder_at e o avanço de fila
  // de reserva (9b) marcariam "já avisei" mesmo sem a mensagem ter saído, e o
  // cliente perderia o aviso pra sempre quando o disjuntor for religado.
  const automacaoPausada = s.automacao_pausada === "true"

  // Cobrança de cliente (seção 7) só dispara em dia útil (seg-sex).
  // Na segunda, também cobre o que venceu no sábado/domingo.
  const cobrancaHabilitada = !isWeekendBR() && !automacaoPausada
  const cobrancaDesde = isWeekendBR(new Date(Date.now() - 86_400_000)) ? subDaysBR(2) : today

  // Nota: lifecycle (novo D2, ausente D15/30/45 + transições pra frio)
  // migrou pro /api/whatsapp/lifecycle-cron (roda de hora em hora, 08h-20h)
  // — antes tudo saía junto às 9h aqui, em menos de 1 minuto.

  if (cobrancaHabilitada) {
  // ── 7. Cobrança no dia do vencimento — produto + DTF, 1 mensagem por cliente ──
  // Só no dia do vencimento (PIV 19/10: aviso diário de vencido virava spam —
  // o antigo 8b deveria avisar 1x, mas o cron estourava o tempo antes de gravar
  // last_reminder_at e repetia todo dia, uma mensagem por pedido). Depois do
  // vencimento não sai mais nada automático. last_reminder_at é gravado logo
  // após cada envio, então rodar de novo no mesmo dia não duplica.
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {})
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {})
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`).catch(() => {})

    const { rows } = await pool.query(`
      SELECT 'order' AS kind, o.id, o.number, o.total_value, o.amount_paid, o.due_date::text AS due_date,
             o.contact_id AS "contactId", c.jid, c.name
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.due_date BETWEEN $2 AND $1
        AND o.paid_at IS NULL
        AND o.status != 'cancelado'
        AND (o.last_reminder_at IS NULL OR o.last_reminder_at < $2::date)
      UNION ALL
      SELECT 'dtf' AS kind, p.id, p.number, p.preco_cobrado AS total_value, p.amount_paid, p.due_date::text AS due_date,
             p.contact_id AS "contactId", c.jid, COALESCE(c.name, p.cliente) AS name
      FROM dtf_pedidos p
      JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.due_date BETWEEN $2 AND $1
        AND p.paid_at IS NULL
        AND p.status != 'cancelado'
        AND (p.last_reminder_at IS NULL OR p.last_reminder_at < $2::date)
      ORDER BY 7, 6, 3
    `, [today, cobrancaDesde])

    const byContact = new Map<number, typeof rows>()
    for (const row of rows) {
      if (!row.jid || !row.name) continue
      const total = row.total_value != null ? Number(row.total_value) : null
      if (total != null && total - Number(row.amount_paid ?? 0) <= 0) continue
      const list = byContact.get(row.contactId) ?? []
      list.push(row)
      byContact.set(row.contactId, list)
    }

    const fmtMoney = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`
    for (const [contactId, list] of byContact) {
      try {
        const firstName = (list[0].name as string).split(" ")[0]
        let sum = 0
        const linhas = list.map(r => {
          const remaining = r.total_value != null ? Math.max(0, Number(r.total_value) - Number(r.amount_paid ?? 0)) : null
          if (remaining != null) sum += remaining
          const quando = r.due_date === today ? "" : ` (venceu ${fmtDateOnlyBR(r.due_date)})`
          return `• *${r.number}*${remaining != null ? ` — ${fmtMoney(remaining)}` : ""}${quando}`
        })
        const quandoUnico = list[0].due_date === today ? "vence hoje" : `venceu em ${fmtDateOnlyBR(list[0].due_date)}`
        const msg = list.length === 1
          ? `Oi ${firstName}, o pagamento do pedido *${list[0].number}* ${quandoUnico}${sum > 0 ? ` — *${fmtMoney(sum)}*` : ""}. Qualquer dúvida é só chamar!`
          : `Oi ${firstName}! Pagamentos com vencimento hoje:\n${linhas.join("\n")}\n\nTotal: *${fmtMoney(sum)}*. Qualquer dúvida é só chamar!`
        await sendAndSave(contactId, list[0].jid as string, msg)
        const orderIds = list.filter(r => r.kind === "order").map(r => r.id)
        const dtfIds   = list.filter(r => r.kind === "dtf").map(r => r.id)
        if (orderIds.length) await pool.query(`UPDATE orders SET last_reminder_at = NOW() WHERE id = ANY($1::int[])`, [orderIds])
        if (dtfIds.length)   await pool.query(`UPDATE dtf_pedidos SET last_reminder_at = NOW() WHERE id = ANY($1::int[])`, [dtfIds])
        results.cobranca++
      } catch { results.errors++ }
      await randDelayClient()
    }
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
  // Fora do bloco cobrancaHabilitada (não depende de dia útil) — precisa do
  // próprio guard: sem isso, a fila avançaria (status='notified') mesmo com
  // o disjuntor pausado, "queimando" a vez do próximo da fila sem avisar ninguém.
  try { if (!automacaoPausada) {
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
  } } catch (e) { console.error("[cron] reserva expiry falhou:", e instanceof Error ? e.message : e); results.errors++ }

  // ── 10. Histórico de WhatsApp só 48h (SM + Evolution) + evicção 500MB ─────────
  try {
    const { mediaCleared, messagesDeleted, dtfAttachmentsCleared, evolutionDeleted } = await runMediaCleanup()
    results.mediaCleared           = mediaCleared
    results.messagesDeleted        = messagesDeleted
    results.dtfAttachmentsCleared  = dtfAttachmentsCleared
    results.evolutionDeleted       = evolutionDeleted
  } catch { results.errors++ }

  // Nota: campanhas avulsas ("enviar agora"/agendadas) e schedules recorrentes
  // migraram pro cron dedicado /api/marketing/cron (roda a cada 5min) — aqui
  // era só 1x/dia, o que fazia qualquer horário marcado depois das 9h nunca
  // disparar e campanha agendada pra data futura nunca sair de "scheduled".

  // ── 13. Contas a Pagar — lembrete no dia do vencimento (grupo SM Administrativo) ─
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
      await sendAdministrativo(msg)
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
