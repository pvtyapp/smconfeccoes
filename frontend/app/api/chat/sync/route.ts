import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

const EVO_PAGE = 200

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

function extractText(msgObj: Record<string, unknown> | undefined): string {
  if (!msgObj) return ""
  return (
    (msgObj.conversation as string) ||
    ((msgObj.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    ""
  )
}

function hasMedia(msgObj: Record<string, unknown> | undefined): boolean {
  if (!msgObj) return false
  return !!(msgObj.imageMessage || msgObj.videoMessage || msgObj.audioMessage ||
            msgObj.documentMessage || msgObj.stickerMessage)
}

// Upsert contact by resolved @s.whatsapp.net JID — returns contact id or null
async function upsertContact(jid: string, name: string): Promise<number | null> {
  const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  const { rows } = await pool.query(
    `INSERT INTO wa_contacts (jid, name, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (jid) DO UPDATE SET
       name       = CASE WHEN EXCLUDED.name ~ '^[0-9]+$' THEN wa_contacts.name ELSE EXCLUDED.name END,
       updated_at = NOW()
     RETURNING id`,
    [jid, name || phone, phone]
  ).catch(() => ({ rows: [] as { id: number }[] }))
  return rows[0]?.id ?? null
}

export async function POST() {
  try {
    // Ensure app_settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).catch(() => {})

    // ── 1. fetchChats: upsert contacts + build read/pic maps ──────────────────
    const chats = await fetchChats()
    const readMap  = new Map<string, number>()  // jid → unreadCount
    const picMap   = new Map<string, string>()  // jid → profilePicUrl

    for (const c of chats) {
      const jid     = ((c.remoteJid ?? c.id) as string) || ""
      const unread  = (c.unreadCount as number) ?? -1
      const pic     = (c.profilePicUrl as string) || ""
      const name    = (c.name as string) || (c.pushName as string) || ""
      if (!jid.endsWith("@s.whatsapp.net")) continue
      readMap.set(jid, unread)
      if (pic) picMap.set(jid, pic)
      await upsertContact(jid, name)
    }

    // Apply profile pics
    for (const [jid, pic] of picMap) {
      pool.query(
        `UPDATE wa_contacts SET profile_pic = $1 WHERE jid = $2 AND (profile_pic IS NULL OR profile_pic != $1)`,
        [pic, jid]
      ).catch(() => {})
    }

    // ── 2. Read-sync: mark contacts PIV already read on phone as read in DB ───
    for (const [jid, unread] of readMap) {
      if (unread <= 0) {
        pool.query(
          `UPDATE wa_messages SET read_at = NOW()
           WHERE read_at IS NULL AND direction = 'in'
             AND contact_id = (SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1)`,
          [jid]
        ).catch(() => {})
      }
    }

    // ── 3. Cursor backfill: incoming messages (handles @lid via remoteJidAlt) ─
    let backfillIn = "skip"
    try {
      const cursorIn = await getSetting("backfill_cursor_in")

      if (cursorIn === null) {
        // First ever run: mass-mark all existing old incoming as read
        await pool.query(
          `UPDATE wa_messages SET read_at = created_at
           WHERE direction = 'in' AND read_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'`
        ).catch(() => {})
        await setSetting("backfill_cursor_in", "0")
        backfillIn = "initialized"

      } else if (cursorIn !== "done") {
        const skip = parseInt(cursorIn) || 0
        const res  = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ where: { key: { fromMe: false } }, skip, limit: EVO_PAGE }),
          signal: sig(10_000),
        })

        if (res.ok) {
          const d = await res.json()
          const records: unknown[] = Array.isArray(d) ? d
            : Array.isArray(d?.messages?.records) ? d.messages.records
            : Array.isArray(d?.records) ? d.records : []

          let saved = 0
          for (const raw of records) {
            const m   = raw as Record<string, unknown>
            const k   = m.key as Record<string, unknown> | undefined
            if (!k) continue

            // Resolve real JID: prefer @s.whatsapp.net over @lid
            const rawJid  = (k.remoteJid  as string) || ""
            const altJid  = (k.remoteJidAlt as string) || ""
            const realJid = rawJid.endsWith("@s.whatsapp.net") ? rawJid
              : altJid.endsWith("@s.whatsapp.net") ? altJid : ""
            if (!realJid) continue

            // Upsert contact inline — no chicken-and-egg
            const pushName  = (m.pushName as string) || ""
            const contactId = await upsertContact(realJid, pushName)
            if (!contactId) continue

            const msgObj = m.message as Record<string, unknown> | undefined
            const text   = extractText(msgObj)
            const media  = hasMedia(msgObj)
            if (!text && !media) continue

            const msgId     = k.id as string | undefined
            const ts        = m.messageTimestamp as number | undefined
            const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
            const isOld     = ts ? (Date.now() - ts * 1000 > 60 * 60 * 1000) : true

            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at, read_at)
               VALUES ($1, $2, 'in', $3, $4, $5)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
                 read_at = COALESCE(wa_messages.read_at, EXCLUDED.read_at)`,
              [contactId, msgId ?? null, text || "[mídia]", createdAt, isOld ? createdAt : null]
            ).catch(() => {})
            saved++
          }

          const next = records.length < EVO_PAGE ? "done" : String(skip + EVO_PAGE)
          await setSetting("backfill_cursor_in", next)
          backfillIn = next === "done" ? "done" : `page ${Math.floor(skip / EVO_PAGE) + 1} (${saved} saved)`
        }
      } else {
        backfillIn = "done"
      }
    } catch { /* non-fatal */ }

    // ── 4. Cursor backfill: outgoing messages ─────────────────────────────────
    let backfillOut = "skip"
    try {
      const cursorOut = await getSetting("backfill_cursor_out")

      if (cursorOut === null) {
        await setSetting("backfill_cursor_out", "0")
        backfillOut = "initialized"

      } else if (cursorOut !== "done") {
        const skip = parseInt(cursorOut) || 0
        const res  = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ where: { key: { fromMe: true } }, skip, limit: EVO_PAGE }),
          signal: sig(10_000),
        })

        if (res.ok) {
          const d = await res.json()
          const records: unknown[] = Array.isArray(d) ? d
            : Array.isArray(d?.messages?.records) ? d.messages.records
            : Array.isArray(d?.records) ? d.records : []

          let saved = 0
          for (const raw of records) {
            const m   = raw as Record<string, unknown>
            const k   = m.key as Record<string, unknown> | undefined
            if (!k) continue

            // Outgoing: remoteJid is the destination (not @lid — our own msgs keep @s.whatsapp.net)
            const remoteJid = (k.remoteJid as string) || ""
            if (!remoteJid.endsWith("@s.whatsapp.net")) continue

            // Look up contact — outgoing msgs go to real @s.whatsapp.net JIDs
            const { rows: cr } = await pool.query(
              `SELECT id FROM wa_contacts WHERE jid = $1 LIMIT 1`, [remoteJid]
            ).catch(() => ({ rows: [] as { id: number }[] }))
            if (!cr.length) continue

            const msgObj = m.message as Record<string, unknown> | undefined
            const text   = extractText(msgObj)
            const media  = hasMedia(msgObj)
            if (!text && !media) continue

            const msgId     = k.id as string | undefined
            const ts        = m.messageTimestamp as number | undefined
            const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at, status)
               VALUES ($1, $2, 'out', $3, $4, 'sent')
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
              [cr[0].id, msgId ?? null, text || "[mídia]", createdAt]
            ).catch(() => {})
            saved++
          }

          const next = records.length < EVO_PAGE ? "done" : String(skip + EVO_PAGE)
          await setSetting("backfill_cursor_out", next)
          backfillOut = next === "done" ? "done" : `page ${Math.floor(skip / EVO_PAGE) + 1} (${saved} saved)`
        }
      } else {
        backfillOut = "done"
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, backfillIn, backfillOut, chats: chats.length })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
