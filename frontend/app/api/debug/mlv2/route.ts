import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: audita 2º teste de arquivo grande (contato MLV) depois de
// desligar webhookBase64 na Evolution.
export async function GET() {
  try {
    const { rows: contacts } = await pool.query(
      `SELECT id, name, phone, jid, phone_jid FROM wa_contacts WHERE name ILIKE '%mlv%' ORDER BY id DESC`
    )
    const contactIds = contacts.map(c => c.id)

    let messages: unknown[] = []
    if (contactIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT id, contact_id, direction, content, media_type, file_name, caption,
                media_category, media_failed, media_data IS NOT NULL AS "hasMediaData",
                LENGTH(media_data) AS "mediaDataLen",
                message_id, created_at
         FROM wa_messages WHERE contact_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 15`,
        [contactIds]
      )
      messages = rows
    }

    const { rows: lastWebhook } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'debug_last_webhook'`
    ).catch(() => ({ rows: [] }))

    return NextResponse.json({ ok: true, contacts, messages, lastWebhook: lastWebhook[0]?.value ?? null })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
