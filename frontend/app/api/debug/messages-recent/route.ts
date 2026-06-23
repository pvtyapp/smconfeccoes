import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Diagnostic: shows last 10 messages across all contacts + schema column status
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

    return NextResponse.json({
      ok: true,
      schema: { columns },
      totalMessages: cnt[0]?.total,
      recentMessages: messages,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
