import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: audita a conversa/pedidos de um contato pelo nome.
// GET /api/debug/rafael?nome=rafael
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const nome = searchParams.get("nome") ?? "rafael"

    const { rows: contacts } = await pool.query(
      `SELECT id, name, phone, jid, phone_jid, linked_user_id, state, state_data, created_at
       FROM wa_contacts WHERE name ILIKE $1 ORDER BY id DESC`,
      [`%${nome}%`]
    )

    const contactIds = contacts.map(c => c.id)
    let messages: unknown[] = []
    let orders: unknown[] = []
    const prodMatches: unknown[] = []
    if (contactIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT id, contact_id, direction, content, media_type, file_name, caption,
                media_category, media_failed, media_data IS NOT NULL AS "hasMediaData",
                message_id, created_at
         FROM wa_messages WHERE contact_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 60`,
        [contactIds]
      )
      messages = rows

      const { rows: ord } = await pool.query(
        `SELECT id, number, status, source, total_value, created_at, updated_at
         FROM orders WHERE contact_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 20`,
        [contactIds]
      )
      orders = ord
    }

    return NextResponse.json({ ok: true, contacts, messages, orders, prodMatches })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
