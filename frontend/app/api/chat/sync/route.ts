import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { waitUntil } from "@vercel/functions"
import { syncMessagesFromEvolution, downloadSyncedMedia } from "@/lib/whatsapp/syncMessages"

export const dynamic = "force-dynamic"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

const CONTACTS_PER_CYCLE = 5

function sig(ms: number) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : new AbortController().signal
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

function isIndividual(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")
}

function extractPhone(c: Record<string, unknown>): string {
  const jid = ((c.remoteJid ?? c.id) as string) || ""
  if (jid.endsWith("@s.whatsapp.net")) {
    return jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  }
  const lastMsg = c.lastMessage as Record<string, unknown> | undefined
  const lastKey = lastMsg?.key as Record<string, unknown> | undefined
  const alt = (lastKey?.remoteJidAlt as string) || ""
  if (alt.endsWith("@s.whatsapp.net")) {
    return alt.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  }
  return jid.replace("@lid", "").replace(/\D/g, "")
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    // ── Migrations ──────────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS phone_jid TEXT`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_message_synced_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_download_failed BOOLEAN DEFAULT FALSE`).catch(() => {})

    // Clear any numeric-only names — name must be a real human name or NULL
    await pool.query(`UPDATE wa_contacts SET name = NULL WHERE name ~ '^[0-9]+$'`).catch(() => {})

    // ── Backfill jid em contatos órfãos (criados sem jid antes do fix) ──────────
    // Sem jid, esse contato é invisível pro merge/limpeza abaixo (que só reconhece
    // jid '%@lid' ou '%@s.whatsapp.net'). Gera o jid a partir do telefone salvo,
    // pulando se já existir outro contato dono desse jid (fica pra correção manual).
    await pool.query(`
      UPDATE wa_contacts
      SET jid = phone || '@s.whatsapp.net', updated_at = NOW()
      WHERE jid IS NULL
        AND phone ~ '^[0-9]{8,15}$'
        AND NOT EXISTS (
          SELECT 1 FROM wa_contacts w2 WHERE w2.jid = wa_contacts.phone || '@s.whatsapp.net'
        )
    `).catch(() => {})

    // ── Fix @lid contacts whose phone column stores the opaque @lid hash ─────────
    // phone_jid stores the real @s.whatsapp.net JID → derive real phone from it
    await pool.query(`
      UPDATE wa_contacts
      SET phone = REPLACE(phone_jid, '@s.whatsapp.net', '')
      WHERE jid LIKE '%@lid'
        AND phone_jid LIKE '%@s.whatsapp.net'
        AND (phone IS NULL OR phone = REPLACE(jid, '@lid', ''))
    `).catch(() => {})

    // ── Merge duplicate contacts (@s.whatsapp.net + @lid for same person) ───────
    const mergeLog: string[] = []

    // 1. Copy name from @s to @lid twin if @lid has no name yet
    await pool.query(`
      UPDATE wa_contacts lid SET name = s.name
      FROM wa_contacts s
      WHERE s.jid LIKE '%@s.whatsapp.net' AND lid.jid LIKE '%@lid'
        AND (lid.phone_jid = s.jid OR lid.phone = s.phone)
        AND lid.name IS NULL AND s.name IS NOT NULL
    `).then(r => mergeLog.push(`name_copy:${r.rowCount}`)).catch(e => mergeLog.push(`name_copy_err:${e}`))

    // 2. Remove exact-duplicate messages already present in the @lid contact
    await pool.query(`
      DELETE FROM wa_messages m
      USING wa_contacts s, wa_contacts lid
      WHERE m.contact_id = s.id
        AND s.jid LIKE '%@s.whatsapp.net' AND lid.jid LIKE '%@lid'
        AND (lid.phone_jid = s.jid OR lid.phone = s.phone)
        AND m.message_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM wa_messages m2
          WHERE m2.contact_id = lid.id AND m2.message_id = m.message_id
        )
    `).then(r => mergeLog.push(`dup_del:${r.rowCount}`)).catch(e => mergeLog.push(`dup_del_err:${e}`))

    // 3. Move remaining messages from @s to @lid (subquery to avoid ambiguous join)
    await pool.query(`
      UPDATE wa_messages m SET contact_id = (
        SELECT lid.id FROM wa_contacts lid
        WHERE lid.jid LIKE '%@lid'
          AND lid.id IN (
            SELECT lid2.id FROM wa_contacts s2
            JOIN wa_contacts lid2 ON lid2.jid LIKE '%@lid'
              AND (lid2.phone_jid = s2.jid OR lid2.phone = s2.phone)
            WHERE s2.id = m.contact_id AND s2.jid LIKE '%@s.whatsapp.net'
          )
        LIMIT 1
      )
      WHERE contact_id IN (
        SELECT s.id FROM wa_contacts s WHERE s.jid LIKE '%@s.whatsapp.net'
          AND EXISTS (SELECT 1 FROM wa_contacts lid WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = s.jid OR lid.phone = s.phone))
      )
    `).then(r => mergeLog.push(`msg_move:${r.rowCount}`)).catch(e => mergeLog.push(`msg_move_err:${e}`))

    // 4a. Move orders from @s to @lid (orders has FK without CASCADE)
    await pool.query(`
      UPDATE orders o SET contact_id = (
        SELECT lid.id FROM wa_contacts s2
        JOIN wa_contacts lid ON lid.jid LIKE '%@lid'
          AND (lid.phone_jid = s2.jid OR lid.phone = s2.phone)
        WHERE s2.id = o.contact_id AND s2.jid LIKE '%@s.whatsapp.net'
        LIMIT 1
      )
      WHERE contact_id IN (
        SELECT s.id FROM wa_contacts s WHERE s.jid LIKE '%@s.whatsapp.net'
          AND EXISTS (SELECT 1 FROM wa_contacts lid WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = s.jid OR lid.phone = s.phone))
      )
    `).then(r => mergeLog.push(`orders_move:${r.rowCount}`)).catch(e => mergeLog.push(`orders_move_err:${e}`))

    // 4b. Move dtf_pedidos from @s to @lid (also no CASCADE)
    await pool.query(`
      UPDATE dtf_pedidos dp SET contact_id = (
        SELECT lid.id FROM wa_contacts s2
        JOIN wa_contacts lid ON lid.jid LIKE '%@lid'
          AND (lid.phone_jid = s2.jid OR lid.phone = s2.phone)
        WHERE s2.id = dp.contact_id AND s2.jid LIKE '%@s.whatsapp.net'
        LIMIT 1
      )
      WHERE contact_id IN (
        SELECT s.id FROM wa_contacts s WHERE s.jid LIKE '%@s.whatsapp.net'
          AND EXISTS (SELECT 1 FROM wa_contacts lid WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = s.jid OR lid.phone = s.phone))
      )
    `).then(r => mergeLog.push(`dtf_move:${r.rowCount}`)).catch(e => mergeLog.push(`dtf_move_err:${e}`))

    // 4c. Delete the now-merged @s.whatsapp.net contacts (skip system contact 0@s)
    await pool.query(`
      DELETE FROM wa_contacts
      WHERE jid LIKE '%@s.whatsapp.net'
        AND jid != '0@s.whatsapp.net'
        AND EXISTS (
          SELECT 1 FROM wa_contacts lid
          WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = wa_contacts.jid OR lid.phone = wa_contacts.phone)
        )
    `).then(r => mergeLog.push(`contact_del:${r.rowCount}`)).catch(e => mergeLog.push(`contact_del_err:${e}`))

    // ── 1. fetchChats: upsert all contacts ──────────────────────────────────────
    const chats = await fetchChats()
    const individualChats = chats.filter(c => {
      const jid = ((c.remoteJid ?? c.id) as string) || ""
      return isIndividual(jid)
    })

    for (const c of individualChats) {
      const jid     = ((c.remoteJid ?? c.id) as string) || ""
      const rawName = (c.pushName as string) || ""
      const name    = /^\d+$/.test(rawName.trim()) ? "" : rawName
      const phone   = extractPhone(c)
      const pic     = (c.profilePicUrl as string) || null
      const phoneJid: string | null = (() => {
        if (!jid.endsWith("@lid")) return null
        const lastMsg = c.lastMessage as Record<string, unknown> | undefined
        const lastKey = lastMsg?.key as Record<string, unknown> | undefined
        const alt = (lastKey?.remoteJidAlt as string) || ""
        return alt.endsWith("@s.whatsapp.net") ? alt : null
      })()

      // Skip @s.whatsapp.net contact if a @lid version already owns this JID (via phone_jid) or phone
      if (jid.endsWith("@s.whatsapp.net") && /^[0-9]{8,15}$/.test(phone)) {
        const { rows: lidExists } = await pool.query(
          `SELECT 1 FROM wa_contacts WHERE jid LIKE '%@lid' AND (phone = $1 OR phone_jid = $2) LIMIT 1`,
          [phone, jid]
        ).catch(() => ({ rows: [] }))
        if (lidExists.length > 0) continue
      }

      await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone, profile_pic, phone_jid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (jid) DO UPDATE SET
           name        = CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name ~ '^[0-9]+$' OR EXCLUDED.name = '' THEN wa_contacts.name ELSE EXCLUDED.name END,
           phone       = CASE WHEN EXCLUDED.phone ~ '^[0-9]{8,15}$' THEN EXCLUDED.phone ELSE wa_contacts.phone END,
           profile_pic = COALESCE(EXCLUDED.profile_pic, wa_contacts.profile_pic),
           phone_jid   = COALESCE(EXCLUDED.phone_jid, wa_contacts.phone_jid),
           updated_at  = NOW()`,
        [jid, name || null, phone, pic, phoneJid]
      ).catch(() => {})
    }

    // ── 2. Read-sync: mark PIV-read conversations as read in DB ─────────────────
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

    // ── 3. Delta sync — per-contact last_message_synced_at ─────────────────────
    // Never-synced contacts first (full fetch), then stale ones (delta fetch)
    const { rows: batch } = await pool.query(`
      SELECT id, jid, last_message_synced_at
      FROM wa_contacts
      WHERE jid LIKE '%@s.whatsapp.net' OR jid LIKE '%@lid'
      ORDER BY
        CASE WHEN last_message_synced_at IS NULL THEN 0 ELSE 1 END,
        last_message_synced_at ASC NULLS FIRST
      LIMIT $1
    `, [CONTACTS_PER_CYCLE])

    let totalSaved = 0

    for (const contact of batch) {
      const contactId  = contact.id as number
      const jid        = contact.jid as string
      const lastSynced = contact.last_message_synced_at as Date | null
      const afterTs    = lastSynced ? Math.floor(lastSynced.getTime() / 1000) : undefined

      // syncMessagesFromEvolution handles: fetch, INSERT with thumbnail, quoted msg, all media fields
      const { pending, processedCount } = await syncMessagesFromEvolution(jid, contactId, { afterTs })
      totalSaved += processedCount

      // Background blob download for any media without a full URL yet
      if (pending.length > 0) {
        waitUntil(downloadSyncedMedia(pending, contactId))
      }

      // For full sync (first time): only mark as synced if Evolution returned records.
      // For delta: always mark — 0 new messages is a valid result meaning no updates.
      const shouldMark = afterTs !== undefined || processedCount > 0
      if (shouldMark) {
        await pool.query(
          `UPDATE wa_contacts SET last_message_synced_at = NOW() WHERE id = $1`,
          [contactId]
        ).catch(() => {})
      }
    }

    // ── Post-upsert merge: clean up any @s contacts re-created by the upsert loop ─
    await pool.query(`
      UPDATE wa_contacts SET phone = REPLACE(phone_jid, '@s.whatsapp.net', '')
      WHERE jid LIKE '%@lid' AND phone_jid LIKE '%@s.whatsapp.net'
        AND (phone IS NULL OR phone = REPLACE(jid, '@lid', ''))
    `).catch(() => {})

    await pool.query(`
      UPDATE orders o SET contact_id = (
        SELECT lid.id FROM wa_contacts s2
        JOIN wa_contacts lid ON lid.jid LIKE '%@lid'
          AND (lid.phone_jid = s2.jid OR lid.phone = s2.phone)
        WHERE s2.id = o.contact_id AND s2.jid LIKE '%@s.whatsapp.net' LIMIT 1
      )
      WHERE contact_id IN (
        SELECT s.id FROM wa_contacts s WHERE s.jid LIKE '%@s.whatsapp.net'
          AND EXISTS (SELECT 1 FROM wa_contacts lid WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = s.jid OR lid.phone = s.phone))
      )
    `).catch(() => {})

    const { rowCount: postMergeDeleted } = await pool.query(`
      DELETE FROM wa_contacts
      WHERE jid LIKE '%@s.whatsapp.net' AND jid != '0@s.whatsapp.net'
        AND NOT EXISTS (SELECT 1 FROM wa_messages WHERE contact_id = wa_contacts.id)
        AND EXISTS (
          SELECT 1 FROM wa_contacts lid WHERE lid.jid LIKE '%@lid'
            AND (lid.phone_jid = wa_contacts.jid OR lid.phone = wa_contacts.phone)
        )
    `).catch(() => ({ rowCount: 0 }))

    return NextResponse.json({
      ok: true,
      contacts: individualChats.length,
      synced: batch.length,
      saved: totalSaved,
      mergeLog,
      postMergeDeleted,
    })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
