import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { deleteBlobs } from "@/lib/blob-cleanup"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export async function POST(req: Request) {
  try {
    const { messageDbId, messageId, jid, fromMe, onlyLocally } = await req.json() as {
      messageDbId: number
      messageId: string | null
      jid: string
      fromMe: boolean
      onlyLocally?: boolean
    }

    if (messageId) {
      // onlyLocally=false → delete for everyone (only works for own messages within 60h)
      // onlyLocally=true  → delete from PIV's WhatsApp only
      const locally = onlyLocally ?? !fromMe
      await fetch(`${EVO_URL}/message/delete/${EVO_INSTANCE}?onlyLocally=${locally}`, {
        method: "DELETE",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ id: messageId, remoteJid: jid, fromMe }),
      }).catch(() => {})
    }

    if (messageDbId) {
      const { rows } = await pool.query<{ media_url: string }>(
        "SELECT media_url FROM wa_messages WHERE id = $1",
        [messageDbId]
      ).catch(() => ({ rows: [] }))
      const blobUrl = rows[0]?.media_url
      if (blobUrl?.startsWith("https://")) await deleteBlobs([blobUrl])
      await pool.query("DELETE FROM wa_messages WHERE id = $1", [messageDbId]).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
