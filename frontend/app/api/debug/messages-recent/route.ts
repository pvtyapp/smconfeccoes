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

    // Test findChats with multiple formats to diagnose Evolution 2.3.7
    let evoFindChats: unknown = null
    try {
      // Try format 1: {skip, limit}
      const fc1 = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ skip: 0, limit: 200 }),
        signal: AbortSignal.timeout(8000),
      })
      const d1 = await fc1.json()
      const arr1: Record<string, unknown>[] = Array.isArray(d1) ? d1 : Array.isArray(d1?.chats) ? d1.chats : Array.isArray(d1?.records) ? d1.records : []
      const byType = { s: 0, lid: 0, group: 0, other: 0 }
      for (const c of arr1) {
        const jid = String(c.remoteJid ?? c.id ?? "")
        if (jid.endsWith("@s.whatsapp.net")) byType.s++
        else if (jid.endsWith("@lid")) byType.lid++
        else if (jid.endsWith("@g.us")) byType.group++
        else byType.other++
      }
      // Sample one of each type
      const sampleLid = arr1.find(c => String(c.remoteJid ?? c.id ?? "").endsWith("@lid"))
      const sampleS   = arr1.find(c => String(c.remoteJid ?? c.id ?? "").endsWith("@s.whatsapp.net"))
      // Test: fetch messages for a @lid contact to confirm query works and check remoteJidAlt
      let lidMsgTest: unknown = null
      if (sampleLid) {
        const lidJid = String(sampleLid.remoteJid ?? sampleLid.id)
        try {
          const fmLid = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
            method: "POST",
            headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ where: { key: { remoteJid: lidJid } }, skip: 0, limit: 3 }),
            signal: AbortSignal.timeout(8000),
          })
          const fmD = await fmLid.json()
          const msgs: Record<string,unknown>[] = Array.isArray(fmD) ? fmD
            : Array.isArray(fmD?.messages?.records) ? fmD.messages.records
            : Array.isArray(fmD?.records) ? fmD.records : []
          lidMsgTest = {
            lidJid,
            status: fmLid.status,
            count: msgs.length,
            sampleMsg: JSON.stringify(msgs[0]).slice(0, 800),
          }
        } catch (e) { lidMsgTest = { error: String(e) } }
      }
      evoFindChats = {
        format1_skipLimit: {
          status: fc1.status,
          count: arr1.length,
          byType,
          sampleLid: JSON.stringify(sampleLid),
          sampleS: JSON.stringify(sampleS).slice(0, 400),
          lidMsgTest,
        }
      }

      // Try format 2: {offset, limit} (new format in some versions)
      const fc2 = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ offset: 0, limit: 200 }),
        signal: AbortSignal.timeout(8000),
      })
      const d2 = await fc2.json()
      const arr2 = Array.isArray(d2) ? d2 : Array.isArray(d2?.chats) ? d2.chats : Array.isArray(d2?.records) ? d2.records : null;
      (evoFindChats as Record<string, unknown>).format2_offsetLimit = {
        status: fc2.status,
        count: arr2?.length ?? "not array",
        topKeys: typeof d2 === "object" && d2 !== null ? Object.keys(d2) : [],
      }

      // Try format 3: empty body GET
      const fc3 = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
        method: "GET",
        headers: { apikey: EVO_KEY },
        signal: AbortSignal.timeout(8000),
      })
      const d3 = await fc3.json()
      const arr3 = Array.isArray(d3) ? d3 : Array.isArray(d3?.chats) ? d3.chats : Array.isArray(d3?.records) ? d3.records : null;
      (evoFindChats as Record<string, unknown>).format3_GET = {
        status: fc3.status,
        count: arr3?.length ?? "not array",
        topKeys: typeof d3 === "object" && d3 !== null ? Object.keys(d3) : [],
      }
    } catch (e) {
      evoFindChats = { error: String(e) }
    }

    // Count contacts in DB + schema
    const { rows: dbContacts } = await pool.query(
      `SELECT COUNT(*) AS total FROM wa_contacts`
    )
    const { rows: contactCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'wa_contacts' ORDER BY ordinal_position
    `).catch(() => ({ rows: [] }))
    // Test conversations query directly
    const { rows: convSample } = await pool.query(`
      SELECT c.id, c.name, c.phone, c.jid, lm.content AS "lastMessage", lm.created_at AS "lastAt"
      FROM wa_contacts c
      JOIN LATERAL (
        SELECT content, created_at FROM wa_messages
        WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1
      ) lm ON true
      ORDER BY lm.created_at DESC LIMIT 5
    `).catch(() => ({ rows: [] }))

    return NextResponse.json({
      ok: true,
      schema: { columns },
      totalMessages: cnt[0]?.total,
      dbContacts: dbContacts[0]?.total,
      contactColumns: contactCols.map((c: {column_name: string}) => c.column_name),
      convSample,
      recentMessages: messages,
      lastWebhook,
      evoUrl: EVO_URL,
      evoInstance: EVO_INSTANCE,
      evoConnection,
      evoFindMessages,
      evoFindChats,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
