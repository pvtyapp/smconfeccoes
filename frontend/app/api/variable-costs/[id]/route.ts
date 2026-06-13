import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// DELETE /api/variable-costs/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await pool.query("DELETE FROM variable_costs WHERE id = $1", [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
