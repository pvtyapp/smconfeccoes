import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

async function syncGroupMessagesFromEvolution(jid: string, groupId: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6_000)
  try {
    const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 80 }),
      signal: ctrl.signal,
    })
    if (!res.ok) return

    const data = await res.json()
    const records: unknown[] =
      Array.isArray(data) ? data :
      Array.isArray(data?.messages?.records) ? data.messages.records :
      Array.isArray(data?.records) ? data.records : []

    for (const r of records) {
      const rec     = r as Record<string, unknown>
      const key     = rec.key as Record<string, unknown> | undefined
      const msgId   = key?.id as string | undefined
      if (!msgId) continue

      const fromMe     = Boolean(key?.fromMe)
      const senderJid  = (key?.participant as string) || (fromMe ? `${EVO_INSTANCE}@s.whatsapp.net` : "")
      const senderName = (rec.pushName as string) || senderJid

      const msgObj = rec.message as Record<string, unknown> | undefined
      const content: string =
        (msgObj?.conversation as string) ||
        ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
        "[mídia]"

      const ts = rec.messageTimestamp as number | undefined
      const createdAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()

      await pool.query(
        `INSERT INTO wa_group_messages (group_id, message_id, sender_jid, sender_name, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [groupId, msgId, senderJid, senderName, content, createdAt]
      ).catch(() => {})
    }
  } catch { /* timeout or Evolution offline */ }
  finally { clearTimeout(timer) }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get("groupId")
    if (!groupId) return NextResponse.json({ error: "groupId obrigatório" }, { status: 400 })

    const groupRes = await pool.query("SELECT jid FROM wa_groups WHERE id = $1", [groupId])
    const jid: string | undefined = groupRes.rows[0]?.jid
    // Fire sync in background — non-blocking
    if (jid) syncGroupMessagesFromEvolution(jid, Number(groupId)).catch(() => {})

    const { rows } = await pool.query(`
      SELECT
        id, sender_jid AS "senderJid", sender_name AS "senderName",
        content, media_type AS "mediaType", created_at AS "createdAt"
      FROM (
        SELECT id, sender_jid, sender_name, content, media_type, created_at
        FROM wa_group_messages
        WHERE group_id = $1
        ORDER BY created_at DESC
        LIMIT 80
      ) sub
      ORDER BY created_at ASC
    `, [groupId])

    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
