import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Extract phone for @s.whatsapp.net and @lid contacts
function extractPhone(c: Record<string, unknown>): string {
  const jid = ((c.remoteJid ?? c.id) as string) || ""
  if (jid.endsWith("@s.whatsapp.net")) {
    return jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  }
  // @lid: phone from lastMessage.key.remoteJidAlt
  const lastMsg = c.lastMessage as Record<string, unknown> | undefined
  const lastKey = lastMsg?.key as Record<string, unknown> | undefined
  const alt = (lastKey?.remoteJidAlt as string) || ""
  if (alt.endsWith("@s.whatsapp.net")) {
    return alt.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  }
  return jid.replace("@lid", "").replace(/\D/g, "")
}

// One-time reset: wipe stale chat data, keep table structures, seed contacts from findChats.
export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).catch(() => {})

    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS profile_pic TEXT`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_message_synced_at TIMESTAMPTZ`).catch(() => {})

    // ── Wipe stale data (keep table structures) ───────────────────────────────
    await pool.query(`TRUNCATE wa_messages RESTART IDENTITY CASCADE`).catch(() => {
      pool.query(`DELETE FROM wa_messages`).catch(() => {})
    })
    await pool.query(`TRUNCATE wa_group_messages RESTART IDENTITY CASCADE`).catch(() => {
      pool.query(`DELETE FROM wa_group_messages`).catch(() => {})
    })
    await pool.query(`TRUNCATE wa_contacts RESTART IDENTITY CASCADE`).catch(() => {
      pool.query(`DELETE FROM wa_contacts`).catch(() => {})
    })

    // Reset all backfill cursors
    await pool.query(
      `DELETE FROM app_settings WHERE key LIKE 'backfill%'`
    ).catch(() => {})

    // ── Seed contacts from findChats ──────────────────────────────────────────
    // Accepts both @s.whatsapp.net and @lid (WhatsApp privacy mode addressing)
    let seededContacts = 0
    try {
      const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ skip: 0, limit: 500 }),
        signal: AbortSignal.timeout(10_000),
      })
      if (r.ok) {
        const d = await r.json()
        const chats: Record<string, unknown>[] = Array.isArray(d) ? d
          : Array.isArray(d?.chats)   ? d.chats
          : Array.isArray(d?.records) ? d.records
          : []

        for (const c of chats) {
          const jid  = ((c.remoteJid ?? c.id) as string) || ""
          // Accept individual contacts: @s.whatsapp.net or @lid (privacy mode)
          if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) continue
          const name  = (c.name as string) || (c.pushName as string) || ""
          const phone = extractPhone(c)
          const pic   = (c.profilePicUrl as string) || null
          await pool.query(
            `INSERT INTO wa_contacts (jid, name, phone, profile_pic)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (jid) DO UPDATE SET
               name        = CASE WHEN EXCLUDED.name ~ '^[0-9]+$' THEN wa_contacts.name ELSE EXCLUDED.name END,
               phone       = CASE WHEN EXCLUDED.phone ~ '^[0-9]{8,15}$' THEN EXCLUDED.phone ELSE wa_contacts.phone END,
               profile_pic = COALESCE(EXCLUDED.profile_pic, wa_contacts.profile_pic),
               updated_at  = NOW()`,
            [jid, name || phone, phone, pic]
          ).catch(() => {})
          seededContacts++
        }
      }
    } catch { /* non-fatal — backfill will discover contacts anyway */ }

    return NextResponse.json({
      ok: true,
      message: "Reset concluído. Backfill iniciará automaticamente nos próximos ciclos de sync.",
      seededContacts,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
