import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query(
      `UPDATE marketing_campaigns
       SET status = 'cancelled', executed_at = NOW()
       WHERE id = $1 AND status IN ('scheduled', 'sending')`,
      [id]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
