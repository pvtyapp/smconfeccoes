import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`
      SELECT
        e.id,
        e.item_id       AS "itemId",
        e.content,
        e.media_url     AS "mediaUrl",
        e.sent_count    AS "sentCount",
        e.error_count   AS "errorCount",
        e.executed_at   AS "executedAt"
      FROM marketing_schedule_executions e
      WHERE e.schedule_id = $1
      ORDER BY e.executed_at DESC
      LIMIT 30
    `, [id])
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
