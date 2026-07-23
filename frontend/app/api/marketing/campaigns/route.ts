import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { generateMarketingVariants } from "@/lib/ai/generateMarketingVariants"

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
             executed_at AS "executedAt", created_at AS "createdAt",
             content_variants AS "contentVariants",
             pause_reason AS "pauseReason",
             paused_until AS "pausedUntil"
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
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS content_variants JSONB`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS pause_reason TEXT`).catch(() => {})

    const body = await req.json() as {
      title?: string
      content: string
      mediaUrl?: string
      audienceType: string
      audienceLifecycle?: string
      audienceGroupJids?: string[]
      scheduledAt?: string | null
      includeColdNew?: boolean
    }

    const { title, content, mediaUrl, audienceType, audienceLifecycle, audienceGroupJids, scheduledAt, includeColdNew } = body

    if (!content?.trim()) return NextResponse.json({ error: "content obrigatório" }, { status: 400 })

    const sendNow = !scheduledAt

    // Build recipient list — stored as queue in DB, processed 1 per tick at 30s intervals
    const contacts = await resolveContacts(audienceType, audienceLifecycle ?? null, !!includeColdNew)
    const groupRecipients = (audienceGroupJids ?? []).map(jid => ({ jid, name: jid.split("@")[0], isGroup: true }))
    const recipients = [
      ...contacts.map(c => ({ jid: c.jid, id: c.id, name: c.name })),
      ...groupRecipients,
    ]
    const totalCount = recipients.length

    // Cliente individual entra em "generating" — a IA reescreve o texto em várias
    // versões antes de deixar o envio de verdade começar (evita mandar texto
    // idêntico pra todo mundo). Grupo puro não precisa disso, vai direto.
    const needsVariants = contacts.length > 0
    const initialStatus = !sendNow ? "scheduled" : (needsVariants ? "generating" : "sending")

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
      initialStatus,
      totalCount,
      JSON.stringify(recipients),
    ])

    const campaignId = rows[0].id

    if (needsVariants) {
      waitUntil(
        generateMarketingVariants(content, Math.min(20, Math.max(8, Math.ceil(contacts.length / 5))))
          .then(async variants => {
            await pool.query(
              `UPDATE marketing_campaigns SET content_variants = $1, status = CASE WHEN status = 'generating' THEN 'sending' ELSE status END WHERE id = $2`,
              [JSON.stringify(variants), campaignId]
            )
          })
          .catch(async err => {
            console.error("[campaigns] geração de variações falhou, seguindo com texto único:", err instanceof Error ? err.message : err)
            await pool.query(
              `UPDATE marketing_campaigns SET status = CASE WHEN status = 'generating' THEN 'sending' ELSE status END WHERE id = $1`,
              [campaignId]
            ).catch(() => {})
          })
      )
    }

    return NextResponse.json({ id: campaignId, sendNow })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function resolveContacts(
  audienceType: string,
  lifecycle: string | null,
  includeColdNew: boolean
): Promise<Array<{ id: number; jid: string; name: string }>> {
  if (audienceType === "groups") return []

  let q = `
    SELECT id, COALESCE(phone_jid, jid) AS jid, name
    FROM wa_contacts
    WHERE jid IS NOT NULL
      AND linked_user_id IS NULL
      AND NOT COALESCE(marketing_optout, false)
      AND (jid NOT LIKE '%@lid' OR phone_jid IS NOT NULL)
  `
  const params: (string | null)[] = []

  if ((audienceType === "lifecycle" || audienceType === "mixed") && lifecycle && lifecycle !== "all") {
    params.push(lifecycle)
    q += ` AND lifecycle_state = $1`
  } else if (!includeColdNew) {
    // "Todos os clientes" sem marcar a opção explícita — exclui frio (já parou de
    // responder há tempo) e novo sem pedido (nunca converteu). É quem mais denuncia
    // propaganda que não pediu; segmento específico escolhido de propósito
    // (ex: escolher "Frio" na tela) sempre respeita a escolha, não filtra de novo.
    q += ` AND lifecycle_state NOT IN ('frio', 'new')`
  }

  const { rows } = await pool.query(q, params)
  return rows
}

