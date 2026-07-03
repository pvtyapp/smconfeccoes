import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"

function sendDelay() {
  // Random 3–8s to avoid deterministic patterns that trigger WhatsApp anti-spam
  return Math.floor(Math.random() * 5_000 + 3_000)
}

const TZ = "America/Sao_Paulo"

function nowBR() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }))
}

export async function POST(req: Request) {
  // Accept CRON_SECRET (Vercel cron header) or external caller with same secret
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results: { campaigns: number; schedules: number; errors: number; errorDetails: string[] } = {
    campaigns: 0, schedules: 0, errors: 0, errorDetails: [],
  }

  // ── 1. Execute pending one-off campaigns ────────────────────────────────────
  try {
    const { rows: pending } = await pool.query(`
      SELECT id, content, media_url AS "mediaUrl",
             audience_type AS "audienceType",
             audience_lifecycle AS "audienceLifecycle",
             audience_group_jids AS "audienceGroupJids"
      FROM marketing_campaigns
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
    `)

    for (const c of pending) {
      let sent = 0, errors = 0
      try {
        await pool.query(`UPDATE marketing_campaigns SET status = 'sending' WHERE id = $1`, [c.id])

        const contacts = await resolveContacts(c.audienceType, c.audienceLifecycle, c.audienceGroupJids)

        for (const ct of contacts) {
          try {
            const firstName = ((ct.name as string | null) ?? "").split(" ")[0]
            const msg = (c.content as string).replace(/\{nome\}/g, firstName)
            const mUrl = c.mediaUrl as string | null
            try {
              await campaignSend(ct.sendJid as string, msg, mUrl)
            } catch (mediaErr) {
              console.error("[campaign-execute] sendMedia falhou para", ct.sendJid, "—", mediaErr instanceof Error ? mediaErr.message : mediaErr)
              if (mUrl) await campaignSend(ct.sendJid as string, msg, null) // fallback texto
              else throw mediaErr
            }
            await pool.query(
              `INSERT INTO wa_messages (contact_id, direction, content, media_url, media_type)
               VALUES ($1,'out',$2,$3,$4)`,
              [ct.id, msg, mUrl ?? null, mUrl ? "image" : null]
            ).catch(() => {})
            sent++
          } catch (e) {
            console.error("[campaign-execute] falhou para", ct.sendJid, "—", e instanceof Error ? e.message : e)
            errors++
          }
          await new Promise(r => setTimeout(r, sendDelay()))
        }

        for (const jid of (c.audienceGroupJids as string[])) {
          try {
            await campaignSend(jid, c.content as string, c.mediaUrl as string | null)
            sent++
          } catch { errors++ }
          await new Promise(r => setTimeout(r, sendDelay()))
        }

        results.campaigns++
      } catch (e) {
        results.errors++; results.errorDetails.push(`campaign ${c.id}: ${e}`)
      } finally {
        await pool.query(`
          UPDATE marketing_campaigns
          SET status = $1, sent_count = $2, error_count = $3, executed_at = NOW()
          WHERE id = $4
        `, [errors > 0 && sent === 0 ? "failed" : "sent", sent, errors, c.id])
      }
    }
  } catch (e) { results.errors++; results.errorDetails.push(`campaigns query: ${e}`) }

  // ── 2. Execute recurring schedules ──────────────────────────────────────────
  try {
    const now = nowBR()
    const currentDay  = now.getDay()
    const currentHour = now.getHours()

    const { rows: schedules } = await pool.query(`
      SELECT id, name, days_of_week AS "daysOfWeek",
             time_of_day::text AS "timeOfDay",
             audience_type AS "audienceType",
             audience_lifecycle AS "audienceLifecycle",
             audience_group_jids AS "audienceGroupJids",
             last_executed_at AS "lastExecutedAt"
      FROM marketing_schedules
      WHERE active = true
    `)

    for (const s of schedules) {
      try {
        // Check day matches
        if (!(s.daysOfWeek as number[]).includes(currentDay)) continue

        // Cron runs every hour — match on hour only
        const [hh] = (s.timeOfDay as string).split(":").map(Number)
        if (hh !== currentHour) continue

        // Avoid double-firing: skip if already ran in the last 90 minutes
        if (s.lastExecutedAt) {
          const minsSince = (Date.now() - new Date(s.lastExecutedAt).getTime()) / 60_000
          if (minsSince < 90) continue
        }

        // Get next item from queue (oldest last_sent_at or never sent)
        const { rows: items } = await pool.query(`
          SELECT id, content, media_url AS "mediaUrl"
          FROM marketing_schedule_items
          WHERE schedule_id = $1
          ORDER BY COALESCE(last_sent_at, '1970-01-01') ASC, created_at ASC
          LIMIT 1
        `, [s.id])

        if (!items[0]) continue

        const item = items[0]
        const contacts = await resolveContacts(s.audienceType, s.audienceLifecycle, s.audienceGroupJids)

        for (const ct of contacts) {
          try {
            const firstName = ((ct.name as string | null) ?? "").split(" ")[0]
            const msg = (item.content as string).replace(/\{nome\}/g, firstName)
            const mUrl = item.mediaUrl as string | null
            try {
              await campaignSend(ct.sendJid as string, msg, mUrl)
            } catch (mediaErr) {
              console.error("[schedule-execute] sendMedia falhou para", ct.sendJid, "—", mediaErr instanceof Error ? mediaErr.message : mediaErr)
              if (mUrl) await campaignSend(ct.sendJid as string, msg, null).catch(() => {})
            }
          } catch (e) {
            console.error("[schedule-execute] falhou para", ct.sendJid, "—", e instanceof Error ? e.message : e)
          }
          await new Promise(r => setTimeout(r, sendDelay()))
        }

        for (const jid of (s.audienceGroupJids as string[])) {
          try { await campaignSend(jid, item.content as string, item.mediaUrl as string | null) }
          catch { /* silent */ }
          await new Promise(r => setTimeout(r, sendDelay()))
        }

        // Mark item as sent + rotate
        await pool.query(`
          UPDATE marketing_schedule_items
          SET last_sent_at = NOW(), sent_count = sent_count + 1
          WHERE id = $1
        `, [item.id])

        // Update last_executed_at on the schedule
        await pool.query(`
          UPDATE marketing_schedules SET last_executed_at = NOW() WHERE id = $1
        `, [s.id])

        // Log execution history
        await pool.query(`
          INSERT INTO marketing_schedule_executions
            (schedule_id, item_id, content, media_url, sent_count, error_count)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [s.id, item.id, item.content, item.mediaUrl ?? null,
            contacts.length + (s.audienceGroupJids as string[]).length, 0])

        results.schedules++
      } catch (e) { results.errors++; results.errorDetails.push(`schedule ${s.id}: ${e}`) }
    }
  } catch (e) { results.errors++; results.errorDetails.push(`schedules query: ${e}`) }

  return NextResponse.json({ ok: true, ...results })
}

async function resolveContacts(
  audienceType: string,
  lifecycle: string | null,
  groupJids: string[]
): Promise<Array<{ id: number; sendJid: string; name: string | null }>> {
  void groupJids
  if (audienceType === "groups") return []

  // Use phone_jid (real @s.whatsapp.net) for @lid contacts.
  // Fallback chain: phone_jid → jid (if not @lid) → phone column + @s.whatsapp.net
  let q = `
    SELECT id,
      COALESCE(
        phone_jid,
        CASE WHEN jid NOT LIKE '%@lid' THEN jid
             ELSE CONCAT(phone, '@s.whatsapp.net')
        END
      ) AS "sendJid",
      CASE WHEN name ~ '^[0-9]+$' THEN NULL ELSE name END AS name
    FROM wa_contacts
    WHERE jid IS NOT NULL`
  const params: (string | null)[] = []

  if ((audienceType === "lifecycle" || audienceType === "mixed") && lifecycle && lifecycle !== "all") {
    params.push(lifecycle)
    q += ` AND lifecycle_state = $1`
  }

  const { rows } = await pool.query(q, params)
  return rows
}
