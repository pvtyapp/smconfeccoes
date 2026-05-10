import { del } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(
      "DELETE FROM catalog_products WHERE id = $1 RETURNING image_url",
      [id]
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    }

    // Remove do Vercel Blob (best-effort — não falha o DELETE se o blob sumir)
    try {
      await del(rows[0].image_url)
    } catch {
      // ignora erro de blob
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("DELETE /api/catalog:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { display_order } = await req.json()

    const { rows } = await pool.query(
      "UPDATE catalog_products SET display_order = $1 WHERE id = $2 RETURNING id, display_order",
      [display_order, id]
    )

    return NextResponse.json(rows[0] ?? { error: "Não encontrado" })
  } catch (err) {
    console.error("PATCH /api/catalog:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
