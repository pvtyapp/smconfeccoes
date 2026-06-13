import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id, p.name, p.image_url, p.display_order, p.description, p.cover_color,
        COALESCE(
          json_agg(
            json_build_object('id', i.id, 'image_url', i.image_url, 'display_order', i.display_order, 'color', i.color)
            ORDER BY i.display_order ASC, i.created_at ASC
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS images
      FROM catalog_products p
      LEFT JOIN catalog_product_images i ON i.product_id = p.id
      WHERE p.active = true
      GROUP BY p.id
      ORDER BY p.display_order ASC, p.created_at ASC
    `)
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN não configurado. Configure em Vercel Dashboard > Storage > Blob." },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const name = (formData.get("name") as string | null)?.trim()
    const description = (formData.get("description") as string | null)?.trim() ?? null
    const coverColor = (formData.get("cover_color") as string | null)?.trim() ?? null
    const cover = formData.get("cover") as File | null

    if (!cover || !name) {
      return NextResponse.json({ error: "name e cover são obrigatórios" }, { status: 400 })
    }

    const coverBlob = await put(`catalog/${Date.now()}-${cover.name}`, cover, { access: "public" })

    const { rows } = await pool.query(
      "INSERT INTO catalog_products (name, image_url, description, cover_color) VALUES ($1, $2, $3, $4) RETURNING id, name, image_url, display_order, description, cover_color",
      [name, coverBlob.url, description, coverColor]
    )
    const product = rows[0]

    const extraImages: { id: string; image_url: string; display_order: number; color: string | null }[] = []
    let i = 0
    while (true) {
      const extra = formData.get(`image_${i}`) as File | null
      if (!extra) break
      const color = (formData.get(`color_${i}`) as string | null)?.trim() ?? null
      const blob = await put(`catalog/${Date.now()}-${i}-${extra.name}`, extra, { access: "public" })
      const { rows: ir } = await pool.query(
        "INSERT INTO catalog_product_images (product_id, image_url, display_order, color) VALUES ($1, $2, $3, $4) RETURNING id, image_url, display_order, color",
        [product.id, blob.url, i, color]
      )
      extraImages.push(ir[0])
      i++
    }

    return NextResponse.json({ ...product, images: extraImages }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/catalog:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
