import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

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

    // Build recipient list — stored as queue in DB, processed 1 per tick at 30s intervals
    const contacts = await resolveContacts(audienceType, audienceLifecycle ?? null, audienceGroupJids ?? [])
    const groupRecipients = (audienceGroupJids ?? []).map(jid => ({ jid, name: jid.split("@")[0], isGroup: true }))
    const recipients = [
      ...contacts.map(c => ({ jid: c.jid, id: c.id, name: c.name })),
      ...groupRecipients,
    ]
    const totalCount = recipients.length

    const { rows } = await pool.query(`
      INSERT INTO marketing_campaigns
        (title, content, media_url, audience_type, audience_lifecycle, audience_group_jids,
         scheduled_at, status, total_count, recipients_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
      JSON.stringify(recipients),
    ])

    const campaignId = rows[0].id

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

