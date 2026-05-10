import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, image_url, display_order FROM catalog_products WHERE active = true ORDER BY display_order ASC, created_at ASC"
    )
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const name = (formData.get("name") as string | null)?.trim()

    if (!file || !name) {
      return NextResponse.json({ error: "name e file são obrigatórios" }, { status: 400 })
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN não configurado. Configure em Vercel Dashboard > Storage > Blob." },
        { status: 500 }
      )
    }

    const blob = await put(`catalog/${Date.now()}-${file.name}`, file, { access: "public" })

    const { rows } = await pool.query(
      "INSERT INTO catalog_products (name, image_url) VALUES ($1, $2) RETURNING id, name, image_url, display_order",
      [name, blob.url]
    )

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/catalog:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
