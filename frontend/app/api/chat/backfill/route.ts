import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

const BATCH = 200

async function fetchMessages(where: Record<string, unknown>, skip = 0): Promise<unknown[]> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where, skip, limit: BATCH }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return []
    const d = await r.json()
    if (Array.isArray(d)) return d
    if (Array.isArray(d?.messages?.records)) return d.messages.records
    if (Array.isArray(d?.records)) return d.records
    return []
  } catch { return [] }
}

function extractText(msg: Record<string, unknown>): string {
  const m = msg.message as Record<string, unknown> | undefined
  if (!m) return ""
  return (
    (m.conversation as string) ||
    ((m.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    (m.imageMessage ? "[imagem]" : "") ||
    (m.documentMessage ? "[documento]" : "") ||
    (m.audioMessage ? "[áudio]" : "") ||
    (m.videoMessage ? "[vídeo]" : "") ||
    (m.stickerMessage ? "[sticker]" : "") ||
    ""
  )
}

export async function POST() {
  let savedGroups = 0
  let savedContacts = 0
  let savedMsgs = 0

  try {
    // ── 1. Backfill group messages ────────────────────────────────────────────
    const { rows: groups } = await pool.query("SELECT id, jid, name FROM wa_groups")

    for (const group of groups) {
      let skip = 0
      let page: unknown[]
      do {
        page = await fetchMessages({ key: { remoteJid: group.jid } }, skip)
        for (const raw of page) {
          const m   = raw as Record<string, unknown>
          const key = m.key as Record<string, unknown> | undefined
          if (!key) continue

          const msgId   = key.id as string | undefined
          const fromMe  = Boolean(key.fromMe)

          // Real sender: use participantAlt (real phone) if participant is @lid
          const participantRaw = key.participant as string | undefined
          const participantAlt = key.participantAlt as string | undefined
          const senderJid = participantAlt ||
            (participantRaw && !participantRaw.endsWith("@lid") ? participantRaw : undefined) ||
            (fromMe ? `${EVO_INSTANCE}@s.whatsapp.net` : "")

          const senderName = (m.pushName as string) || senderJid || ""
          const content    = extractText(m)
          const ts         = m.messageTimestamp as number | undefined
          const createdAt  = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

          if (!content) continue

          await pool.query(
            `INSERT INTO wa_group_messages (group_id, message_id, sender_jid, sender_name, content, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (message_id) DO NOTHING`,
            [group.id, msgId ?? null, senderJid, senderName, content, createdAt]
          ).catch(() => {})
          savedGroups++
        }
        skip += BATCH
      } while (page.length === BATCH)
    }

    // Update group updated_at to reflect latest message time
    await pool.query(`
      UPDATE wa_groups g SET updated_at = (
        SELECT MAX(created_at) FROM wa_group_messages WHERE group_id = g.id
      ) WHERE EXISTS (SELECT 1 FROM wa_group_messages WHERE group_id = g.id)
    `).catch(() => {})

    // ── 2. Backfill individual (non-group) messages ───────────────────────────
    // Get all non-group messages, excluding fromMe=false messages to self
    const allIndividual = await fetchMessages(
      { key: { remoteJid: { contains: "@s.whatsapp.net" } } }, 0
    )

    const byContact = new Map<string, unknown[]>()
    for (const raw of allIndividual) {
      const m   = raw as Record<string, unknown>
      const key = m.key as Record<string, unknown> | undefined
      const jid = key?.remoteJid as string | undefined
      if (!jid || !jid.endsWith("@s.whatsapp.net")) continue
      if (!byContact.has(jid)) byContact.set(jid, [])
      byContact.get(jid)!.push(m)
    }

    for (const [jid, msgs] of byContact) {
      const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      // Skip the instance's own number
      if (phone === EVO_INSTANCE.replace(/\D/g, "")) continue

      // Upsert contact
      const anyMsg = msgs.find(raw => {
        const m = raw as Record<string, unknown>
        const k = m.key as Record<string, unknown>
        return !k?.fromMe && (m.pushName as string)
      }) as Record<string, unknown> | undefined

      const name = (anyMsg?.pushName as string) || phone
      const { rows: cr } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone)
         VALUES ($1, $2, $3)
         ON CONFLICT (jid) DO UPDATE SET
           name = CASE WHEN EXCLUDED.name != EXCLUDED.phone THEN EXCLUDED.name ELSE wa_contacts.name END,
           updated_at = NOW()
         RETURNING id`,
        [jid, name, phone]
      )
      const contactId = cr[0]?.id
      if (!contactId) continue
      savedContacts++

      // Save messages
      for (const raw of msgs) {
        const m   = raw as Record<string, unknown>
        const key = m.key as Record<string, unknown> | undefined
        if (!key) continue
        const content = extractText(m)
        if (!content) continue
        const msgId    = key.id as string | undefined
        const fromMe   = Boolean(key.fromMe)
        const direction = fromMe ? "out" : "in"
        const ts        = m.messageTimestamp as number | undefined
        const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [contactId, msgId ?? null, direction, content, createdAt]
        ).catch(() => {})
        savedMsgs++
      }
    }

    // ── 3. Delete fake/test contacts ─────────────────────────────────────────
    await pool.query(`
      DELETE FROM wa_contacts
      WHERE phone IN ('5519999900001','5519999900002','5511999990000')
         OR (name LIKE 'Teste%' AND phone ~ '^999')
         OR phone = '00000000000'
         OR phone = '0'
         OR jid = '5516992692363@s.whatsapp.net'
    `).catch(() => {})

    return NextResponse.json({ ok: true, savedGroups, savedContacts, savedMsgs })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
