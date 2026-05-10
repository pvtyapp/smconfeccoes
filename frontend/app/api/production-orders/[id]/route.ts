import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Cascade deleta itens e movimentações de estoque associadas ficam (são histórico)
    await pool.query("DELETE FROM production_orders WHERE id = $1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("DELETE /api/production-orders/[id]:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
