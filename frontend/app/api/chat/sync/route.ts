import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { syncContactMessages } from "@/lib/whatsapp/syncMessages"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : new AbortController().signal
}

// Discovers contacts from real conversation history (fromMe=false messages only)
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
      const key = (m.key as Record<string, unknown>) ?? {}
      const jid = (key.remoteJid as string) ?? ""
      // Only real phone JIDs — skip groups, broadcasts, @lid
      if (!jid.endsWith("@s.whatsapp.net")) continue
      if (!seen.has(jid)) {
        const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
        const name = (m.pushName as string) || phone
        seen.set(jid, { jid, name, phone })
      }
    }
    return Array.from(seen.values())
  } catch { return [] }
}

// Fetches profile pics from findChats (returns what WhatsApp has synced)
async function fetchProfilePics(): Promise<Map<string, string>> {
  try {
    const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ skip: 0, limit: 500 }),
      signal: withTimeout(8_000),
    })
    if (!r.ok) return new Map()
    const data = await r.json()
    const items: Record<string, string>[] = Array.isArray(data) ? data
      : Array.isArray(data?.chats) ? data.chats
      : Array.isArray(data?.records) ? data.records
      : []
    const map = new Map<string, string>()
    for (const c of items) {
      const jid = c.remoteJid || ""
      const pic = c.profilePicUrl || ""
      if (jid && pic) map.set(jid, pic)
    }
    return map
  } catch { return new Map() }
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
    // Ensure schema columns exist
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS profile_pic TEXT`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_message_synced_at TIMESTAMPTZ`).catch(() => {})

    // Cleanup: remove garbage contacts (@lid JIDs or non-WA JIDs)
    await pool.query(`
      DELETE FROM wa_contacts
      WHERE jid LIKE '%@lid'
         OR (jid NOT LIKE '%@s.whatsapp.net' AND jid NOT LIKE '%@g.us')
    `).catch(() => {})

    const [contacts, profilePics, groups] = await Promise.all([
      discoverContactsFromMessages(),
      fetchProfilePics(),
      fetchEvolutionGroups(),
    ])

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

    // Sync messages for the 20 most recently active contacts that haven't been synced in 90s.
    // Critical fallback when Evolution webhooks are not firing — ensures new messages
    // appear in the conversation list even for contacts not currently open in the chat view.
    const { rows: staleContacts } = await pool.query(`
      SELECT id, jid FROM wa_contacts
      WHERE jid LIKE '%@s.whatsapp.net'
        AND (last_message_synced_at IS NULL OR last_message_synced_at < NOW() - INTERVAL '90 seconds')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 20
    `).catch(() => ({ rows: [] }))

    if (staleContacts.length > 0) {
      // Mark all as syncing now before we fire the background jobs (prevents double-sync on concurrent calls)
      const ids = staleContacts.map((c: { id: number }) => c.id)
      await pool.query(
        `UPDATE wa_contacts SET last_message_synced_at = NOW() WHERE id = ANY($1)`,
        [ids]
      ).catch(() => {})

      // Fire background sync for each contact — waitUntil keeps function alive after response
      waitUntil(
        Promise.allSettled(
          staleContacts.map((c: { id: number; jid: string }) => syncContactMessages(c.jid, c.id))
        )
      )
    }

    return NextResponse.json({ ok: true, syncedContacts, syncedGroups, bgSyncing: staleContacts.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
