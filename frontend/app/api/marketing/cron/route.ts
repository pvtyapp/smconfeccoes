import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"

export const maxDuration = 60 // Vercel Hobby max

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelay = () => sleep(3000 + Math.random() * 5000) // 3–8s

type Recipient = { jid: string; id?: number; name: string; isGroup?: boolean }

export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Ensure columns exist
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_marketing_sent_at TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS marketing_optout BOOLEAN DEFAULT FALSE`).catch(() => {})

  const results = { campaignSent: 0, scheduleSent: 0, errors: 0 }

  // ── 1. Campaign: process up to 5 messages from the oldest active campaign ─────
  try {
    const { rows: [camp] } = await pool.query(`
      SELECT id, content, media_url, recipients_json, sent_count, total_count, status
      FROM marketing_campaigns
      WHERE status = 'sending'
      ORDER BY created_at ASC
      LIMIT 1
    `)

    if (camp) {
      const recipients = (camp.recipients_json ?? []) as Recipient[]
      const BATCH = 8

      for (let i = 0; i < BATCH; i++) {
        const idx = (camp.sent_count as number) + i
        if (idx >= recipients.length) {
          await pool.query(`UPDATE marketing_campaigns SET status = 'sent', executed_at = NOW() WHERE id = $1`, [camp.id])
          break
        }

        const recipient = recipients[idx]
        let sendJid = recipient.jid as string

        // Resolve real JID — skip opted-out or already messaged today
        if (recipient.id && !recipient.isGroup) {
          const { rows: guard } = await pool.query(
            `SELECT COALESCE(phone_jid,
               CASE WHEN jid NOT LIKE '%@lid' THEN jid ELSE NULL END
             ) AS send_jid, marketing_optout, last_marketing_sent_at
             FROM wa_contacts WHERE id = $1`,
            [recipient.id]
          ).catch(() => ({ rows: [] as { send_jid: string; marketing_optout: boolean; last_marketing_sent_at: Date | null }[] }))

          const g = guard[0]
          if (!g) { await countDone(camp.id, idx, recipients.length, false); continue }
          if (g.marketing_optout) { await countDone(camp.id, idx, recipients.length, false); continue }
          if (g.last_marketing_sent_at && (Date.now() - g.last_marketing_sent_at.getTime()) < 20 * 60 * 60 * 1000) {
            await countDone(camp.id, idx, recipients.length, false); continue
          }
          if (g.send_jid) sendJid = g.send_jid
        }

        // @lid with no phone_jid — skip
        if (sendJid.endsWith("@lid")) { await countDone(camp.id, idx, recipients.length, false); continue }

        let hasError = false
        try {
          const firstName = ((recipient.name as string | null) ?? "").split(" ")[0]
          const msg = recipient.isGroup
            ? (camp.content as string)
            : (camp.content as string).replace(/\{nome\}/g, firstName)
          await campaignSend(sendJid, msg, camp.media_url as string | null)

          if (recipient.id) {
            await pool.query(`UPDATE wa_contacts SET last_marketing_sent_at = NOW() WHERE id = $1`, [recipient.id]).catch(() => {})
            await pool.query(
              `INSERT INTO wa_messages (contact_id, direction, content, media_url, media_type) VALUES ($1,'out',$2,$3,$4)`,
              [recipient.id, msg, camp.media_url ?? null, camp.media_url ? "image" : null]
            ).catch(() => {})
          }
          results.campaignSent++
        } catch (e) {
          console.error("[marketing-cron] campaign send error:", e instanceof Error ? e.message : e)
          hasError = true
          results.errors++
        }

        await pool.query(
          `UPDATE marketing_campaigns
           SET sent_count = $1,
               error_count = error_count + $2,
               status = CASE WHEN $1 >= total_count THEN 'sent' ELSE status END,
               executed_at = CASE WHEN $1 >= total_count THEN NOW() ELSE executed_at END
           WHERE id = $3`,
          [idx + 1, hasError ? 1 : 0, camp.id]
        )

        if (idx + 1 >= recipients.length) break
        await randDelay()
      }
    }
  } catch (e) {
    console.error("[marketing-cron] campaign block error:", e instanceof Error ? e.message : e)
    results.errors++
  }

  // ── 2. Schedules: fire any due schedule (max 5 recipients each, max 3 schedules) ──
  try {
    // Day-of-week in Brasília (0=Sun, 1=Mon … 6=Sat)
    const brDay = Number(new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCDay())

    const { rows: dueSchedules } = await pool.query(`
      SELECT id, content_placeholder, audience_type, audience_lifecycle, audience_group_jids
      FROM marketing_schedules
      WHERE active = true
        AND $1 = ANY(days_of_week)
        AND time_of_day <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::time
        AND (last_executed_at IS NULL
             OR DATE(last_executed_at AT TIME ZONE 'America/Sao_Paulo')
                < (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo'))
      LIMIT 3
    `, [brDay])

    for (const sched of dueSchedules) {
      try {
        // Pick next item (least recently sent, round-robin)
        const { rows: [item] } = await pool.query(`
          SELECT id, content, media_url AS "mediaUrl"
          FROM marketing_schedule_items
          WHERE schedule_id = $1
          ORDER BY COALESCE(last_sent_at, '1970-01-01') ASC, id ASC
          LIMIT 1
        `, [sched.id])

        if (!item) continue

        const recipients = await resolveScheduleContacts(
          sched.audience_type,
          sched.audience_lifecycle,
          sched.audience_group_jids ?? []
        )

        let sentCount = 0
        let errCount  = 0

        for (const r of recipients.slice(0, 5)) {
          try {
            const firstName = ((r.name as string | null) ?? "").split(" ")[0]
            const msg = (item.content as string).replace(/\{nome\}/g, firstName)
            await campaignSend(r.jid as string, msg, item.mediaUrl as string | null)
            if (r.id) {
              await pool.query(`UPDATE wa_contacts SET last_marketing_sent_at = NOW() WHERE id = $1`, [r.id]).catch(() => {})
            }
            sentCount++
            results.scheduleSent++
          } catch (e) {
            console.error("[marketing-cron] schedule send error:", e instanceof Error ? e.message : e)
            errCount++
            results.errors++
          }
          await randDelay()
        }

        // Record execution
        await pool.query(`
          INSERT INTO marketing_schedule_executions (schedule_id, item_id, content, media_url, sent_count, error_count)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [sched.id, item.id, item.content, item.mediaUrl ?? null, sentCount, errCount]).catch(() => {})

        await pool.query(`UPDATE marketing_schedules SET last_executed_at = NOW() WHERE id = $1`, [sched.id])
        await pool.query(
          `UPDATE marketing_schedule_items SET last_sent_at = NOW(), sent_count = sent_count + $1 WHERE id = $2`,
          [sentCount, item.id]
        )
      } catch (e) {
        console.error("[marketing-cron] schedule block error:", e instanceof Error ? e.message : e)
        results.errors++
      }
    }
  } catch (e) {
    console.error("[marketing-cron] schedules error:", e instanceof Error ? e.message : e)
    results.errors++
  }

  return NextResponse.json({ ok: true, ...results })
}

async function countDone(campaignId: number, idx: number, total: number, hasError: boolean) {
  await pool.query(
    `UPDATE marketing_campaigns
     SET sent_count = $1,
         error_count = error_count + $2,
         status = CASE WHEN $1 >= $3 THEN 'sent' ELSE status END,
         executed_at = CASE WHEN $1 >= $3 THEN NOW() ELSE executed_at END
     WHERE id = $4`,
    [idx + 1, hasError ? 1 : 0, total, campaignId]
  ).catch(() => {})
}

async function resolveScheduleContacts(
  audienceType: string,
  lifecycle: string | null,
  groupJids: string[]
): Promise<Array<{ id: number; jid: string; name: string }>> {
  if (audienceType === "groups") {
    return groupJids.map(jid => ({ id: 0, jid, name: jid.split("@")[0] }))
  }

  let q = `
    SELECT id, COALESCE(phone_jid, jid) AS jid, name
    FROM wa_contacts
    WHERE jid IS NOT NULL
      AND NOT COALESCE(marketing_optout, false)
      AND (jid NOT LIKE '%@lid' OR phone_jid IS NOT NULL)
      AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
  `
  const params: string[] = []

  if ((audienceType === "lifecycle" || audienceType === "mixed") && lifecycle && lifecycle !== "all") {
    params.push(lifecycle)
    q += ` AND lifecycle_state = $1`
  }

  const { rows } = await pool.query(q, params)
  return rows
}
