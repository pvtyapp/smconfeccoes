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

      if (onlyLocally ?? !fromMe) {
        // Só some da nossa visão — não é "apagar para todos" de verdade, nada
        // mudou pro cliente, então não faz sentido deixar tombstone.
        await pool.query("DELETE FROM wa_messages WHERE id = $1", [messageDbId]).catch(() => {})
      } else {
        // "Apagar para todos" de verdade — soft-delete, fica "🚫 Mensagem apagada"
        // no lugar (mesmo padrão do webhook quando o outro lado apaga).
        await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`).catch(() => {})
        await pool.query(`
          UPDATE wa_messages
          SET deleted_at = NOW(), content = NULL, media_type = NULL, media_url = NULL,
              media_thumb = NULL, media_data = NULL, media_category = NULL,
              file_name = NULL, caption = NULL, updated_at = NOW()
          WHERE id = $1
        `, [messageDbId]).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
