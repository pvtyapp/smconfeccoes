import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { generateMarketingVariants } from "@/lib/ai/generateMarketingVariants"
import { getInstanceState } from "@/lib/whatsapp/evolutionInstances"

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
             paused_until AS "pausedUntil",
             instance_name AS "instanceName"
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
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS instance_name TEXT`).catch(() => {})
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_instances (
        id SERIAL PRIMARY KEY,
        instance_name TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})

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

    const contacts = await resolveContacts(audienceType, audienceLifecycle ?? null, !!includeColdNew)
    const groupRecipients = (audienceGroupJids ?? []).map(jid => ({ jid, name: jid.split("@")[0], isGroup: true }))

    // Divide os clientes entre os números de marketing conectados agora —
    // cada número recebe sua própria fatia, roda independente (se um cair,
    // os outros continuam). Grupo nunca entra nessa divisão, vai tudo junto
    // na primeira fatia (sempre manda pelo número principal mesmo assim).
    const registered = await pool.query(`
      SELECT instance_name AS "instanceName", label FROM marketing_instances WHERE active = true ORDER BY id ASC
    `).then(r => r.rows as { instanceName: string; label: string }[]).catch(() => [])

    const connected: { instanceName: string; label: string }[] = []
    for (const inst of registered) {
      if (await getInstanceState(inst.instanceName) === "connected") connected.push(inst)
    }

    const slices: { instanceName: string | null; label: string | null; contacts: typeof contacts }[] =
      connected.length > 0
        ? connected.map((inst, i) => ({
            instanceName: inst.instanceName,
            label: connected.length > 1 ? inst.label : null,
            contacts: contacts.filter((_, idx) => idx % connected.length === i),
          }))
        : [{ instanceName: null, label: null, contacts }]

    // Cliente individual entra em "generating" — a IA reescreve o texto em várias
    // versões antes de deixar o envio de verdade começar (evita mandar texto
    // idêntico pra todo mundo). Mesmo banco de variações é reaproveitado em
    // todos os números — WhatsApp avalia cada número separado, repetir frase
    // entre números diferentes não recria o padrão de "texto idêntico".
    const needsVariants = contacts.length > 0
    const initialStatus = !sendNow ? "scheduled" : (needsVariants ? "generating" : "sending")

    const createdIds: number[] = []
    let groupsAttached = false
    for (const slice of slices) {
      // Fatia de cliente vazia (menos clientes que números conectados) só pula
      // se não for a única chance de anexar o grupo ainda pendente.
      if (slice.contacts.length === 0 && slices.length > 1 && (groupsAttached || groupRecipients.length === 0)) continue

      const attachGroups = !groupsAttached
      const recipients = [
        ...slice.contacts.map(c => ({ jid: c.jid, id: c.id, name: c.name })),
        ...(attachGroups ? groupRecipients : []),
      ]
      const totalCount = recipients.length
      if (totalCount === 0) continue
      if (attachGroups) groupsAttached = true

      const sliceTitle = slice.label ? `${title ?? ""} — ${slice.label}`.trim() : (title ?? "")

      const { rows } = await pool.query(`
        INSERT INTO marketing_campaigns
          (title, content, media_url, audience_type, audience_lifecycle, audience_group_jids,
           scheduled_at, status, total_count, recipients_json, instance_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [
        sliceTitle,
        content,
        mediaUrl ?? null,
        audienceType,
        audienceLifecycle ?? null,
        audienceGroupJids ?? [],
        scheduledAt ? new Date(scheduledAt) : null,
        initialStatus,
        totalCount,
        JSON.stringify(recipients),
        slice.instanceName,
      ])
      createdIds.push(rows[0].id)
    }

    if (createdIds.length === 0) {
      return NextResponse.json({ error: "Nenhum destinatário encontrado" }, { status: 400 })
    }

    if (needsVariants) {
      waitUntil(
        generateMarketingVariants(content, Math.min(20, Math.max(8, Math.ceil(contacts.length / 5))))
          .then(async variants => {
            await pool.query(
              `UPDATE marketing_campaigns SET content_variants = $1, status = CASE WHEN status = 'generating' THEN 'sending' ELSE status END WHERE id = ANY($2::int[])`,
              [JSON.stringify(variants), createdIds]
            )
          })
          .catch(async err => {
            console.error("[campaigns] geração de variações falhou, seguindo com texto único:", err instanceof Error ? err.message : err)
            await pool.query(
              `UPDATE marketing_campaigns SET status = CASE WHEN status = 'generating' THEN 'sending' ELSE status END WHERE id = ANY($1::int[])`,
              [createdIds]
            ).catch(() => {})
          })
      )
    }

    return NextResponse.json({ ids: createdIds, sendNow })
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

