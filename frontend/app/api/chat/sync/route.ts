import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { syncContactMessages } from "@/lib/whatsapp/syncMessages"

export const dynamic = "force-dynamic"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

const EVO_PAGE = 200

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : new AbortController().signal
}

async function getAppSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = $1`, [key]
  ).catch(() => ({ rows: [] as { value: string }[] }))
  return rows[0]?.value ?? null
}

async function setAppSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  ).catch(() => {})
}

// Discovers contacts from real conversation history — handles @lid addressing via remoteJidAlt
async function discoverContactsFromMessages(): Promise<Array<{ jid: string; name: string; phone: string }>> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { fromMe: false } }, skip: 0, limit: 2000 }),
      signal: withTimeout(8_000),
    })
    if (!r.ok) return []
    const data = await r.json()
    const raw: Record<string, unknown>[] =
      Array.isArray(data) ? data :
      Array.isArray(data?.messages?.records) ? data.messages.records :
      Array.isArray(data?.records) ? data.records : []

    const seen = new Map<string, { jid: string; name: string; phone: string }>()
    for (const m of raw) {
      const key    = (m.key as Record<string, unknown>) ?? {}
      const rawJid = (key.remoteJid as string) ?? ""
      const altJid = (key.remoteJidAlt as string) ?? ""
      // Accept both direct @s.whatsapp.net and @lid (with alt field)
      const jid = rawJid.endsWith("@s.whatsapp.net") ? rawJid
        : altJid.endsWith("@s.whatsapp.net") ? altJid : ""
      if (!jid) continue
      if (!seen.has(jid)) {
        const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
        const name  = (m.pushName as string) || phone
        seen.set(jid, { jid, name, phone })
      }
    }
    return Array.from(seen.values())
  } catch { return [] }
}

// Returns findChats data — used for profile pics AND read-sync
async function fetchChats(): Promise<Record<string, unknown>[]> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ skip: 0, limit: 500 }),
      signal: withTimeout(8_000),
    })
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data) ? data
      : Array.isArray(data?.chats) ? data.chats
      : Array.isArray(data?.records) ? data.records
      : []
  } catch { return [] }
}

async function fetchEvolutionGroups(): Promise<Array<Record<string, string>>> {
  try {
    const r = await fetch(
      `${EVO_URL}/group/fetchAllGroups/${EVO_INSTANCE}?getParticipants=false`,
      { headers: { apikey: EVO_KEY }, signal: withTimeout(8_000) }
    )
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function POST() {
  try {
    // Ensure schema exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS profile_pic TEXT`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_message_synced_at TIMESTAMPTZ`).catch(() => {})

    // Cleanup: remove garbage contacts (@lid JIDs or non-WA JIDs)
    await pool.query(`
      DELETE FROM wa_contacts
      WHERE jid LIKE '%@lid'
         OR (jid NOT LIKE '%@s.whatsapp.net' AND jid NOT LIKE '%@g.us')
    `).catch(() => {})

    const [contacts, chats, groups] = await Promise.all([
      discoverContactsFromMessages(),
      fetchChats(),
      fetchEvolutionGroups(),
    ])

    // Build profile pic map from chats
    const profilePics = new Map<string, string>()
    for (const c of chats) {
      const jid = (c.remoteJid as string) || ""
      const pic = (c.profilePicUrl as string) || ""
      if (jid && pic) profilePics.set(jid, pic)
    }

    let syncedContacts = 0
    for (const { jid, name, phone } of contacts) {
      const picUrl = profilePics.get(jid) ?? null
      await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone, profile_pic)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (jid) DO UPDATE SET
           name        = CASE WHEN EXCLUDED.name != EXCLUDED.phone THEN EXCLUDED.name ELSE wa_contacts.name END,
           profile_pic = COALESCE(EXCLUDED.profile_pic, wa_contacts.profile_pic),
           updated_at  = NOW()`,
        [jid, name, phone, picUrl]
      ).catch(() => {})
      syncedContacts++
    }

    let syncedGroups = 0
    for (const g of groups) {
      const jid  = g.id || ""
      if (!jid) continue
      const name = g.subject || g.name || jid
      await pool.query(
        `INSERT INTO wa_groups (jid, name, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (jid) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [jid, name]
      ).catch(() => {})
      syncedGroups++
    }

    // Sync messages for the 50 most recently active contacts that haven't been synced in 30s.
    const { rows: staleContacts } = await pool.query(`
      SELECT id, jid FROM wa_contacts
      WHERE jid LIKE '%@s.whatsapp.net'
        AND (last_message_synced_at IS NULL OR last_message_synced_at < NOW() - INTERVAL '30 seconds')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 50
    `).catch(() => ({ rows: [] }))

    if (staleContacts.length > 0) {
      const ids = staleContacts.map((c: { id: number }) => c.id)
      await pool.query(
        `UPDATE wa_contacts SET last_message_synced_at = NOW() WHERE id = ANY($1)`,
        [ids]
      ).catch(() => {})

      waitUntil(
        Promise.allSettled(
          staleContacts.map((c: { id: number; jid: string }) => syncContactMessages(c.jid, c.id))
        )
      )
    }

    // ── findChats read-sync: mark contacts with unreadCount=0 as fully read ────
    // Runs every cycle — keeps dashboard in sync when PIV reads on the phone
    try {
      for (const chat of chats) {
        const chatJid   = ((chat.remoteJid ?? chat.id) as string) || ""
        const unread    = (chat.unreadCount as number) ?? -1
        if (!chatJid.endsWith("@s.whatsapp.net")) continue
        if (unread <= 0) {
          pool.query(
            `UPDATE wa_messages SET read_at = NOW()
             WHERE read_at IS NULL AND direction = 'in'
               AND contact_id = (SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1)`,
            [chatJid]
          ).catch(() => {})
        }
      }
    } catch { /* non-fatal */ }

    // ── Cursor backfill: incoming (@lid) messages ─────────────────────────────
    // Each sync cycle processes 1 page (200 msgs). 26k msgs ÷ 200 = ~130 cycles (~65 min).
    let backfillInStatus = "skip"
    try {
      const cursorIn = await getAppSetting("backfill_cursor_in")
      if (cursorIn === null) {
        // First run: mass-mark all old incoming as read before starting
        await pool.query(
          `UPDATE wa_messages SET read_at = created_at
           WHERE direction = 'in' AND read_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'`
        ).catch(() => {})
        await setAppSetting("backfill_cursor_in", "0")
        backfillInStatus = "initialized"
      } else if (cursorIn !== "done") {
        const skip = parseInt(cursorIn) || 0
        const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ where: { key: { fromMe: false } }, skip, limit: EVO_PAGE }),
          signal: withTimeout(10_000),
        })
        if (res.ok) {
          const d = await res.json()
          const records: unknown[] = Array.isArray(d) ? d
            : Array.isArray(d?.messages?.records) ? d.messages.records
            : Array.isArray(d?.records) ? d.records : []

          for (const raw of records) {
            const m = raw as Record<string, unknown>
            const k = m.key as Record<string, unknown> | undefined
            if (!k) continue
            const rawJid  = (k.remoteJid as string) || ""
            const altJid  = (k.remoteJidAlt as string) || ""
            const realJid = rawJid.endsWith("@s.whatsapp.net") ? rawJid
              : altJid.endsWith("@s.whatsapp.net") ? altJid : ""
            if (!realJid) continue
            const { rows: cr } = await pool.query(
              `SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1`, [realJid]
            ).catch(() => ({ rows: [] as { id: number }[] }))
            if (!cr.length) continue
            const msgObj   = m.message as Record<string, unknown> | undefined
            const text     = (msgObj?.conversation as string) || ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) || ""
            const hasMedia = !!(msgObj?.imageMessage || msgObj?.videoMessage || msgObj?.audioMessage || msgObj?.documentMessage || msgObj?.stickerMessage)
            if (!text && !hasMedia) continue
            const msgId     = k.id as string | undefined
            const ts        = m.messageTimestamp as number | undefined
            const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
            const isOld     = ts ? (Date.now() - ts * 1000 > 60 * 60 * 1000) : true
            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at, read_at)
               VALUES ($1, $2, 'in', $3, $4, $5)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
                 read_at = COALESCE(wa_messages.read_at, EXCLUDED.read_at)`,
              [cr[0].id, msgId ?? null, text || "[mídia]", createdAt, isOld ? createdAt : null]
            ).catch(() => {})
          }

          const nextCursor = records.length < EVO_PAGE ? "done" : String(skip + EVO_PAGE)
          await setAppSetting("backfill_cursor_in", nextCursor)
          backfillInStatus = nextCursor === "done" ? "done" : `page ${Math.floor(skip / EVO_PAGE) + 1}`
        }
      } else {
        backfillInStatus = "done"
      }
    } catch { /* non-fatal */ }

    // ── Cursor backfill: outgoing messages ────────────────────────────────────
    let backfillOutStatus = "skip"
    try {
      const cursorOut = await getAppSetting("backfill_cursor_out")
      if (cursorOut === null) {
        await setAppSetting("backfill_cursor_out", "0")
        backfillOutStatus = "initialized"
      } else if (cursorOut !== "done") {
        const skip = parseInt(cursorOut) || 0
        const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ where: { key: { fromMe: true } }, skip, limit: EVO_PAGE }),
          signal: withTimeout(10_000),
        })
        if (res.ok) {
          const d = await res.json()
          const records: unknown[] = Array.isArray(d) ? d
            : Array.isArray(d?.messages?.records) ? d.messages.records
            : Array.isArray(d?.records) ? d.records : []

          for (const raw of records) {
            const m = raw as Record<string, unknown>
            const k = m.key as Record<string, unknown> | undefined
            if (!k) continue
            const remoteJid = (k.remoteJid as string) || ""
            if (!remoteJid.endsWith("@s.whatsapp.net")) continue
            const { rows: cr } = await pool.query(
              `SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1`, [remoteJid]
            ).catch(() => ({ rows: [] as { id: number }[] }))
            if (!cr.length) continue
            const msgObj   = m.message as Record<string, unknown> | undefined
            const text     = (msgObj?.conversation as string) || ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) || ""
            const hasMedia = !!(msgObj?.imageMessage || msgObj?.videoMessage || msgObj?.audioMessage || msgObj?.documentMessage || msgObj?.stickerMessage)
            if (!text && !hasMedia) continue
            const msgId     = k.id as string | undefined
            const ts        = m.messageTimestamp as number | undefined
            const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at, status)
               VALUES ($1, $2, 'out', $3, $4, 'sent')
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
              [cr[0].id, msgId ?? null, text || "[mídia]", createdAt]
            ).catch(() => {})
          }

          const nextCursor = records.length < EVO_PAGE ? "done" : String(skip + EVO_PAGE)
          await setAppSetting("backfill_cursor_out", nextCursor)
          backfillOutStatus = nextCursor === "done" ? "done" : `page ${Math.floor(skip / EVO_PAGE) + 1}`
        }
      } else {
        backfillOutStatus = "done"
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      syncedContacts,
      syncedGroups,
      bgSyncing: staleContacts.length,
      backfillIn: backfillInStatus,
      backfillOut: backfillOutStatus,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
