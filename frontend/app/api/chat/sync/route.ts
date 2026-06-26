import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// How many contacts to backfill per sync cycle (each makes 1 Evolution call)
const CONTACTS_PER_CYCLE = 5
const MSGS_PER_CONTACT   = 200

function sig(ms: number) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : new AbortController().signal
}

async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = $1`, [key]
  ).catch(() => ({ rows: [] as { value: string }[] }))
  return rows[0]?.value ?? null
}

async function setSetting(key: string, value: string) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  ).catch(() => {})
}

async function fetchChats(): Promise<Record<string, unknown>[]> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ skip: 0, limit: 500 }),
      signal: sig(8_000),
    })
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d) ? d
      : Array.isArray(d?.chats)   ? d.chats
      : Array.isArray(d?.records) ? d.records
      : []
  } catch { return [] }
}

async function fetchMessagesForJid(jid: string, skip = 0): Promise<unknown[]> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, skip, limit: MSGS_PER_CONTACT }),
      signal: sig(8_000),
    })
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d) ? d
      : Array.isArray(d?.messages?.records) ? d.messages.records
      : Array.isArray(d?.records) ? d.records
      : []
  } catch { return [] }
}

function extractText(msgObj: Record<string, unknown> | undefined): string {
  if (!msgObj) return ""
  return (msgObj.conversation as string)
    || ((msgObj.extendedTextMessage as Record<string, unknown>)?.text as string)
    || ""
}

function hasMedia(msgObj: Record<string, unknown> | undefined): boolean {
  if (!msgObj) return false
  return !!(msgObj.imageMessage || msgObj.videoMessage || msgObj.audioMessage ||
            msgObj.documentMessage || msgObj.stickerMessage)
}

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
    `).catch(() => {})

    // ── 1. fetchChats: build full contact list ────────────────────────────────
    const chats = await fetchChats()

    // Individual chats only (skip groups)
    const individualChats = chats.filter(c => {
      const jid = ((c.remoteJid ?? c.id) as string) || ""
      return jid.endsWith("@s.whatsapp.net")
    })

    // Upsert all contacts from findChats
    for (const c of individualChats) {
      const jid   = ((c.remoteJid ?? c.id) as string) || ""
      const name  = (c.name as string) || (c.pushName as string) || ""
      const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      const pic   = (c.profilePicUrl as string) || null
      await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone, profile_pic)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (jid) DO UPDATE SET
           name        = CASE WHEN EXCLUDED.name ~ '^[0-9]+$' THEN wa_contacts.name ELSE EXCLUDED.name END,
           profile_pic = COALESCE(EXCLUDED.profile_pic, wa_contacts.profile_pic),
           updated_at  = NOW()`,
        [jid, name || phone, phone, pic]
      ).catch(() => {})
    }

    // ── 2. Read-sync: mark PIV-read contacts as read in DB ────────────────────
    for (const c of individualChats) {
      const jid    = ((c.remoteJid ?? c.id) as string) || ""
      const unread = (c.unreadCount as number) ?? -1
      if (unread <= 0) {
        pool.query(
          `UPDATE wa_messages SET read_at = NOW()
           WHERE read_at IS NULL AND direction = 'in'
             AND contact_id = (SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1)`,
          [jid]
        ).catch(() => {})
      }
    }

    // ── 3. Per-contact backfill cursor ────────────────────────────────────────
    // Stores the index into the sorted JID list we've processed up to.
    // Each cycle: take next CONTACTS_PER_CYCLE contacts, fetch their full history.
    const sortedJids = individualChats
      .map(c => ((c.remoteJid ?? c.id) as string) || "")
      .filter(Boolean)
      .sort()

    const cursorRaw   = await getSetting("backfill_contact_idx")
    const allDone     = cursorRaw === "done"
    const cursorIdx   = allDone ? 0 : (parseInt(cursorRaw ?? "0") || 0)

    let backfillStatus = "skip"

    if (!allDone && sortedJids.length > 0) {
      const batch = sortedJids.slice(cursorIdx, cursorIdx + CONTACTS_PER_CYCLE)
      let totalSaved = 0

      for (const jid of batch) {
        // Get contact id
        const { rows: cr } = await pool.query(
          `SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1`, [jid]
        ).catch(() => ({ rows: [] as { id: number }[] }))
        if (!cr.length) continue
        const contactId = cr[0].id

        // Fetch all pages for this contact
        let skip = 0
        let page: unknown[]
        do {
          page = await fetchMessagesForJid(jid, skip)
          for (const raw of page) {
            const m   = raw as Record<string, unknown>
            const k   = m.key as Record<string, unknown> | undefined
            if (!k) continue
            const msgObj = m.message as Record<string, unknown> | undefined
            const text   = extractText(msgObj)
            const media  = hasMedia(msgObj)
            if (!text && !media) continue
            const msgId     = k.id as string | undefined
            const fromMe    = Boolean(k.fromMe)
            const ts        = m.messageTimestamp as number | undefined
            const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
            const isOld     = ts ? (Date.now() - ts * 1000 > 60 * 60 * 1000) : true
            const readAt    = (!fromMe && isOld) ? createdAt : null

            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at, read_at, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
                 read_at = COALESCE(wa_messages.read_at, EXCLUDED.read_at)`,
              [contactId, msgId ?? null, fromMe ? "out" : "in", text || "[mídia]",
               createdAt, readAt, fromMe ? "sent" : null]
            ).catch(() => {})
            totalSaved++
          }
          skip += MSGS_PER_CONTACT
        } while (page.length === MSGS_PER_CONTACT)
      }

      const nextIdx = cursorIdx + batch.length
      const isDone  = nextIdx >= sortedJids.length
      await setSetting("backfill_contact_idx", isDone ? "done" : String(nextIdx))
      backfillStatus = isDone
        ? `done (${sortedJids.length} contacts)`
        : `contacts ${cursorIdx}–${nextIdx - 1} of ${sortedJids.length} (${totalSaved} saved)`
    } else if (allDone) {
      backfillStatus = "done"
    } else {
      backfillStatus = "no contacts"
    }

    return NextResponse.json({
      ok: true,
      contacts: individualChats.length,
      backfill: backfillStatus,
    })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
