import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`
      SELECT id, content, media_url AS "mediaUrl",
             last_sent_at AS "lastSentAt", sent_count AS "sentCount",
             created_at AS "createdAt"
      FROM marketing_schedule_items
      WHERE schedule_id = $1
      ORDER BY COALESCE(last_sent_at, '1970-01-01') ASC, created_at ASC
    `, [id])
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { content, mediaUrl } = await req.json() as { content: string; mediaUrl?: string }

    if (!content?.trim()) return NextResponse.json({ error: "content obrigatório" }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO marketing_schedule_items (schedule_id, content, media_url)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [id, content, mediaUrl ?? null])

    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
