import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { imageId } = await params
    await pool.query("DELETE FROM product_images WHERE id = $1", [imageId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
