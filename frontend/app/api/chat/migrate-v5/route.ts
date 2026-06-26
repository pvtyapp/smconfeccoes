import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// One-time reset: wipe stale chat data, keep table structures, seed contacts from findChats.
// Call once after deploy to start with a clean slate.
export async function POST() {
  try {
    // Ensure app_settings exists before anything else
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

    // ── Seed contacts from findChats (fast, no @lid issues) ──────────────────
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
          if (!jid.endsWith("@s.whatsapp.net")) continue
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
