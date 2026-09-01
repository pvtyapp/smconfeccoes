import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"
import { processCampaignBatch } from "@/lib/whatsapp/processCampaign"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelayGroup  = () => sleep(3000 + Math.random() * 5000)   // 3-8s, grupo — risco baixo
const randDelayClient = () => sleep(30000 + Math.random() * 30000) // 30-60s, cliente individual — bem mais devagar

// Sem isso, a Vercel mata a função no tempo padrão (bem menor que o
// necessário) -- medido na prática: 10 destinatários com a pausa anti-ban
// entre cada um já passam de 1 minuto. Sem erro nenhum registrado, a função
// só para de mandar no meio da lista. 280s dá folga confortável até pro
// pior caso (schedule com bastante grupo).
export const maxDuration = 280

// Vercel Cron: */5 * * * * (a cada 5 minutos)
//
// Separado do cron diário (/api/whatsapp/cron, 9h BRT) porque campanha
// agendada e programação recorrente precisam de granularidade de minuto pra
// o horário escolhido na tela ter efeito de verdade. Antes só existia o cron
// diário — qualquer horário marcado depois das 9h nunca disparava, e uma
// campanha agendada pra data futura nunca saía do status "scheduled".
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = { scheduledCampaignsDue: 0, campaignSent: 0, scheduleSent: 0, errors: 0 }

  // ── 1. Campanhas avulsas agendadas — vira "sending" quando chega a hora ─────
  try {
    const { rowCount } = await pool.query(`
      UPDATE marketing_campaigns
      SET status = 'sending'
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
    `)
    results.scheduledCampaignsDue = rowCount ?? 0
  } catch { results.errors++ }

  // ── 2. Processa até 4 mensagens da campanha "sending" mais antiga em fila ──
  // Cobre tanto "enviar agora" quanto as que acabaram de virar "sending" acima.
  // Era 8 até 2026-08-10 — com o delay de cliente subindo pra 40-60s, 8 no
  // pior caso (480s) estourava maxDuration=280s e a Vercel matava a função no
  // meio do envio sem erro nenhum registrado. 4 no pior caso (240s) deixa a
  // mesma folga que o motor de schedule recorrente já usa (ver seção 3 abaixo).
  try {
    const { processed, errors } = await processCampaignBatch(4)
    results.campaignSent = processed
    results.errors += errors
  } catch { results.errors++ }

  // ── 3. Schedules recorrentes — dispara os do dia, no horário marcado ───────
  // LIMIT 1: com vários grupos por programação, o tempo de envio (pausa
  // anti-ban entre cada um) já é grande sozinho. Processar mais de uma
  // programação atrasada na mesma chamada multiplicaria esse tempo e
  // arriscaria o timeout de novo mesmo com maxDuration alto. Como o cron
  // roda a cada 5min, a próxima atrasada pega na chamada seguinte.
  try {
    const brDay = Number(new Date(Date.now() - 3 * 3600 * 1000).getUTCDay())
    const { rows: dueSchedules } = await pool.query(`
      SELECT id, audience_type, audience_lifecycle, audience_group_jids
      FROM marketing_schedules
      WHERE active = true
        AND $1 = ANY(days_of_week)
        AND time_of_day <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::time
        AND (last_executed_at IS NULL
             OR DATE(last_executed_at AT TIME ZONE 'America/Sao_Paulo')
                < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
      LIMIT 1
    `, [brDay])
    for (const sched of dueSchedules) {
      try {
        const { rows: [item] } = await pool.query(
          `SELECT id, content, media_url AS "mediaUrl" FROM marketing_schedule_items
           WHERE schedule_id = $1 ORDER BY COALESCE(last_sent_at,'1970-01-01') ASC, id ASC LIMIT 1`, [sched.id]
        )
        if (!item) continue

        // Destinatário depende da audiência escolhida — "groups" manda direto
        // pros JIDs dos grupos salvos, sem consultar wa_contacts. "mixed" soma
        // os dois. Antes disso, qualquer audiência (inclusive "groups" puro)
        // caía sempre na busca de contatos individuais, porque nada aqui lia
        // audience_group_jids — mandava pra gente aleatória em vez do grupo.
        type Rcpt = { id?: number; jid: string; name: string; isGroup?: boolean }
        let contactRcpts: Rcpt[] = []
        if (sched.audience_type !== "groups") {
          let q = `SELECT id, jid, COALESCE(nome_cadastro, name) AS name FROM wa_contacts
                   WHERE jid IS NOT NULL AND NOT COALESCE(marketing_optout,false)
                     AND linked_user_id IS NULL
                     AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')`
          const qp: string[] = []
          if (sched.audience_type !== "all" && sched.audience_lifecycle) { qp.push(sched.audience_lifecycle); q += ` AND lifecycle_state = $1` }
          // Quem nunca recebeu (NULL) ou recebeu há mais tempo entra primeiro —
          // sem isso, o teto de 20 abaixo sempre pegava a mesma fatia da lista
          // (sem ORDER BY o Postgres devolve em ordem física estável) e o resto
          // da base nunca era alcançado, execução após execução.
          q += ` ORDER BY last_marketing_sent_at ASC NULLS FIRST`
          const { rows } = await pool.query(q, qp)
          // Teto explícito por orçamento de tempo: maxDuration=280s, delay
          // anti-ban de cliente é 30-60s (grupos deste disparo entram no mesmo
          // laço, mesmo orçamento) — no pior caso (60s) 4 destinatários = 240s,
          // deixa folga pro resto. Sem teto nenhum, uma programação pra "todos
          // os clientes" com base grande estouraria o timeout e a função seria
          // morta no meio do envio. Combinado com o ORDER BY acima, cada
          // execução avança pra próxima fatia — gira por toda a base em vários
          // dias em vez de travar nos mesmos contatos.
          contactRcpts = rows.slice(0, 4)
        }
        const groupRcpts: Rcpt[] = (sched.audience_type === "groups" || sched.audience_type === "mixed")
          ? ((sched.audience_group_jids ?? []) as string[]).map(jid => ({ jid, name: jid.split("@")[0], isGroup: true }))
          : []
        const rcpts: Rcpt[] = [...contactRcpts, ...groupRcpts]
        let sentCount = 0
        let errorCount = 0
        for (const r of rcpts) {
          try {
            const msg = (item.content as string).replace(/\{nome\}/gi, ((r.name ?? "").split(" ")[0]))
            const msgId = await campaignSend(r.jid as string, msg, item.mediaUrl as string | null)
            if (r.id) {
              await pool.query(`UPDATE wa_contacts SET last_marketing_sent_at = NOW() WHERE id = $1`, [r.id]).catch(() => {})
              await pool.query(
                `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_url, media_type)
                 VALUES ($1,$2,'out',$3,$4,$5)
                 ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
                [r.id, msgId, msg, item.mediaUrl ?? null, item.mediaUrl ? "image" : null]
              ).catch(() => {})
            }
            sentCount++; results.scheduleSent++
          } catch (e) {
            errorCount++; results.errors++
            console.error("[marketing/cron] falha ao enviar pro destinatário", r.jid, "—", e instanceof Error ? e.message : e)
          }
          await (r.isGroup ? randDelayGroup() : randDelayClient())
        }
        await pool.query(`INSERT INTO marketing_schedule_executions (schedule_id, item_id, content, media_url, sent_count, error_count) VALUES ($1,$2,$3,$4,$5,$6)`,
          [sched.id, item.id, item.content, item.mediaUrl ?? null, sentCount, errorCount]).catch(() => {})
        await pool.query(`UPDATE marketing_schedules SET last_executed_at = NOW() WHERE id = $1`, [sched.id])
        await pool.query(`UPDATE marketing_schedule_items SET last_sent_at = NOW(), sent_count = sent_count + $1 WHERE id = $2`, [sentCount, item.id])
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  return NextResponse.json({ ok: true, ...results })
}
