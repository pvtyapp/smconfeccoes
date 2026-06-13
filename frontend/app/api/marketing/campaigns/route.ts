import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, content, media_url AS "mediaUrl",
             audience_type AS "audienceType",
             audience_lifecycle AS "audienceLifecycle",
             audience_group_jids AS "audienceGroupJids",
             scheduled_at AS "scheduledAt",
             status, sent_count AS "sentCount",
             error_count AS "errorCount", total_count AS "totalCount",
             executed_at AS "executedAt", created_at AS "createdAt"
      FROM marketing_campaigns
      ORDER BY created_at DESC
      LIMIT 100
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title?: string
      content: string
      mediaUrl?: string
      audienceType: string
      audienceLifecycle?: string
      audienceGroupJids?: string[]
      scheduledAt?: string | null
    }

    const { title, content, mediaUrl, audienceType, audienceLifecycle, audienceGroupJids, scheduledAt } = body

    if (!content?.trim()) return NextResponse.json({ error: "content obrigatório" }, { status: 400 })

    const sendNow = !scheduledAt

    // Build recipient list to know total_count
    const contacts = await resolveContacts(audienceType, audienceLifecycle ?? null, audienceGroupJids ?? [])
    const totalCount = contacts.length + (audienceGroupJids?.length ?? 0)

    const { rows } = await pool.query(`
      INSERT INTO marketing_campaigns
        (title, content, media_url, audience_type, audience_lifecycle, audience_group_jids,
         scheduled_at, status, total_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `, [
      title ?? "",
      content,
      mediaUrl ?? null,
      audienceType,
      audienceLifecycle ?? null,
      audienceGroupJids ?? [],
      scheduledAt ? new Date(scheduledAt) : null,
      sendNow ? "sending" : "scheduled",
      totalCount,
    ])

    const campaignId = rows[0].id

    if (sendNow) {
      // Fire-and-forget execution
      executeCampaign(campaignId, content, mediaUrl ?? null, contacts, audienceGroupJids ?? []).catch(() => {})
    }

    return NextResponse.json({ id: campaignId, sendNow })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function resolveContacts(
  audienceType: string,
  lifecycle: string | null,
  groupJids: string[]
): Promise<Array<{ id: number; jid: string; name: string }>> {
  if (audienceType === "groups") return []

  let q = `SELECT id, jid, name FROM wa_contacts WHERE jid IS NOT NULL`
  const params: (string | null)[] = []

  if ((audienceType === "lifecycle" || audienceType === "mixed") && lifecycle && lifecycle !== "all") {
    params.push(lifecycle)
    q += ` AND lifecycle_state = $1`
  }

  const { rows } = await pool.query(q, params)
  return rows
}

async function executeCampaign(
  campaignId: number,
  content: string,
  mediaUrl: string | null,
  contacts: Array<{ id: number; jid: string; name: string }>,
  groupJids: string[]
) {
  let sent = 0, errors = 0

  for (const c of contacts) {
    try {
      const msg = content.replace(/\{nome\}/g, (c.name ?? "").split(" ")[0])
      await campaignSend(c.jid, msg, mediaUrl)
      await pool.query(
        `INSERT INTO wa_messages (contact_id, direction, content) VALUES ($1,'out',$2)`,
        [c.id, msg]
      ).catch(() => {})
      sent++
    } catch { errors++ }
    await new Promise(r => setTimeout(r, 350))
  }

  for (const jid of groupJids) {
    try {
      await campaignSend(jid, content, mediaUrl)
      sent++
    } catch { errors++ }
    await new Promise(r => setTimeout(r, 350))
  }

  await pool.query(`
    UPDATE marketing_campaigns
    SET status = $1, sent_count = $2, error_count = $3, executed_at = NOW()
    WHERE id = $4
  `, [errors > 0 && sent === 0 ? "failed" : "sent", sent, errors, campaignId])
}
