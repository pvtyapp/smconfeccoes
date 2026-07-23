import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params
    const { content, mediaUrl } = await req.json() as { content: string; mediaUrl?: string | null }
    if (!content?.trim()) return NextResponse.json({ error: "content obrigatório" }, { status: 400 })

    await pool.query(
      `UPDATE marketing_schedule_items SET content = $1, media_url = $2 WHERE id = $3`,
      [content, mediaUrl ?? null, itemId]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params
    await pool.query(`DELETE FROM marketing_schedule_items WHERE id = $1`, [itemId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
