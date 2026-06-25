import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Diagnostic: shows last 10 messages, schema, Evolution connection state, and findMessages test
export async function GET() {
  try {
    // Check which columns exist in wa_messages
    const { rows: cols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'wa_messages'
      ORDER BY ordinal_position
    `)
    const columns = cols.map((c: { column_name: string }) => c.column_name)

    // Last 10 messages regardless of contact
    const { rows: messages } = await pool.query(`
      SELECT m.id, m.contact_id, c.name, c.phone, m.direction, m.content,
             m.media_type, m.created_at, m.message_id
      FROM wa_messages m
      LEFT JOIN wa_contacts c ON c.id = m.contact_id
      ORDER BY m.id DESC
      LIMIT 10
    `)

    // Count total messages
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS total FROM wa_messages`)

    // Last webhook received
    const { rows: wh } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'debug_last_webhook'`
    ).catch(() => ({ rows: [] }))
    const lastWebhook = wh[0]?.value ? JSON.parse(wh[0].value) : null

    // Most recent contact JID for findMessages test
    const { rows: recentContact } = await pool.query(
      `SELECT c.jid, c.name FROM wa_contacts c
       JOIN wa_messages m ON m.contact_id = c.id
       WHERE c.jid LIKE '%@s.whatsapp.net'
       ORDER BY m.id DESC LIMIT 1`
    ).catch(() => ({ rows: [] }))

    // Test Evolution connection state
    let evoConnection: unknown = null
    let evoFindMessages: unknown = null
    try {
      const connRes = await fetch(
        `${EVO_URL}/instance/connectionState/${EVO_INSTANCE}`,
        { headers: { apikey: EVO_KEY }, signal: AbortSignal.timeout(5000) }
      )
      evoConnection = await connRes.json()
    } catch (e) {
      evoConnection = { error: String(e) }
    }

    // Test findMessages for most recent contact
    if (recentContact[0]?.jid) {
      try {
        const fmRes = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
          method: "POST",
          headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ where: { key: { remoteJid: recentContact[0].jid } }, limit: 3 }),
          signal: AbortSignal.timeout(6000),
        })
        const fmData = await fmRes.json()
        evoFindMessages = {
          status: fmRes.status,
          contact: recentContact[0].name || recentContact[0].jid,
          rawKeys: typeof fmData === "object" && fmData !== null ? Object.keys(fmData) : typeof fmData,
          isArray: Array.isArray(fmData),
          sampleLength: (() => {
              if (Array.isArray(fmData)) return fmData.length
              const d = fmData as { messages?: { records?: unknown[] }; records?: unknown[] }
              if (Array.isArray(d?.messages?.records)) return d.messages!.records!.length
              if (Array.isArray(d?.records)) return d.records!.length
              return "unknown format"
            })(),
          raw: JSON.stringify(fmData).slice(0, 500),
        }
      } catch (e) {
        evoFindMessages = { error: String(e) }
      }
    }

    return NextResponse.json({
      ok: true,
      schema: { columns },
      totalMessages: cnt[0]?.total,
      recentMessages: messages,
      lastWebhook,
      evoUrl: EVO_URL,
      evoInstance: EVO_INSTANCE,
      evoConnection,
      evoFindMessages,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
