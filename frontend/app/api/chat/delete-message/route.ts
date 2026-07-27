import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { deleteBlobs } from "@/lib/blob-cleanup"
import { getProvider } from "@/lib/whatsapp/provider"

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
      const provider = await getProvider()
      await provider.deleteMessage(messageId, jid, fromMe, locally).catch(() => {})
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
