import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`
      SELECT
        media_data     AS "mediaData",
        media_thumb    AS "mediaThumb",
        media_category AS "mediaCategory",
        COALESCE(media_failed, false) AS "mediaFailed",
        (media_data IS NULL AND created_at < NOW() - INTERVAL '48 hours') AS expired
      FROM wa_messages
      WHERE id = $1
    `, [id])
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
