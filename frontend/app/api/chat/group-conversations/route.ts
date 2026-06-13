import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        g.id,
        g.jid,
        g.name,
        g.updated_at      AS "lastAt",
        m.content         AS "lastMessage",
        m.sender_name     AS "lastSenderName"
      FROM wa_groups g
      LEFT JOIN LATERAL (
        SELECT content, sender_name
        FROM wa_group_messages
        WHERE group_id = g.id
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON true
      ORDER BY g.updated_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
