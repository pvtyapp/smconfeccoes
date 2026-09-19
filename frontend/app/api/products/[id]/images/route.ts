import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { rows } = await pool.query(
      `SELECT id, color, image_url AS "imageUrl", display_order AS "displayOrder"
       FROM product_images WHERE product_id = $1
       ORDER BY color NULLS FIRST, display_order ASC, created_at ASC`,
      [id]
    )
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN não configurado. Configure em Vercel Dashboard > Storage > Blob." },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const color = (formData.get("color") as string | null)?.trim() || null
    if (!file) return NextResponse.json({ error: "file é obrigatório" }, { status: 400 })

    const blob = await put(`products/${id}/${Date.now()}-${file.name}`, file, { access: "public" })

    const { rows: maxOrder } = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM product_images
       WHERE product_id = $1 AND color IS NOT DISTINCT FROM $2`,
      [id, color]
    )
    const { rows } = await pool.query(
      `INSERT INTO product_images (product_id, color, image_url, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, color, image_url AS "imageUrl", display_order AS "displayOrder"`,
      [id, color, blob.url, maxOrder[0].next]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
