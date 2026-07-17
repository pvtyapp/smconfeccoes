import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"
import { processCampaignBatch } from "@/lib/whatsapp/processCampaign"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelay = () => sleep(3000 + Math.random() * 5000) // 3–8s anti-ban

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

  // ── 2. Processa até 8 mensagens da campanha "sending" mais antiga em fila ──
  // Cobre tanto "enviar agora" quanto as que acabaram de virar "sending" acima.
  try {
    const { processed, errors } = await processCampaignBatch(8)
    results.campaignSent = processed
    results.errors += errors
  } catch { results.errors++ }

  // ── 3. Schedules recorrentes — dispara os do dia, no horário marcado ───────
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
      LIMIT 3
    `, [brDay])
    for (const sched of dueSchedules) {
      try {
        const { rows: [item] } = await pool.query(
          `SELECT id, content, media_url AS "mediaUrl" FROM marketing_schedule_items
           WHERE schedule_id = $1 ORDER BY COALESCE(last_sent_at,'1970-01-01') ASC, id ASC LIMIT 1`, [sched.id]
        )
        if (!item) continue
        let q = `SELECT id, COALESCE(phone_jid, jid) AS jid, name FROM wa_contacts
                 WHERE jid IS NOT NULL AND NOT COALESCE(marketing_optout,false)
                   AND linked_user_id IS NULL
                   AND (jid NOT LIKE '%@lid' OR phone_jid IS NOT NULL)
                   AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')`
        const qp: string[] = []
        if (sched.audience_type !== "all" && sched.audience_lifecycle) { qp.push(sched.audience_lifecycle); q += ` AND lifecycle_state = $1` }
        const { rows: rcpts } = await pool.query(q, qp)
        let sentCount = 0
        for (const r of rcpts.slice(0, 5)) {
          try {
            const msg = (item.content as string).replace(/\{nome\}/g, ((r.name ?? "").split(" ")[0]))
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
          } catch { results.errors++ }
          await randDelay()
        }
        await pool.query(`INSERT INTO marketing_schedule_executions (schedule_id, item_id, content, media_url, sent_count, error_count) VALUES ($1,$2,$3,$4,$5,0)`,
          [sched.id, item.id, item.content, item.mediaUrl ?? null, sentCount]).catch(() => {})
        await pool.query(`UPDATE marketing_schedules SET last_executed_at = NOW() WHERE id = $1`, [sched.id])
        await pool.query(`UPDATE marketing_schedule_items SET last_sent_at = NOW(), sent_count = sent_count + $1 WHERE id = $2`, [sentCount, item.id])
      } catch { results.errors++ }
    }
  } catch { results.errors++ }

  return NextResponse.json({ ok: true, ...results })
}
