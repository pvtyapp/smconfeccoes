import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const MAX_BANNERS = 5

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hero_banners (
      id            SERIAL PRIMARY KEY,
      image_url     TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`
      SELECT id, image_url, display_order FROM hero_banners ORDER BY display_order ASC, created_at ASC
    `)
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN não configurado. Configure em Vercel Dashboard > Storage > Blob." },
        { status: 500 }
      )
    }

    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM hero_banners`)
    if (countRows[0].count >= MAX_BANNERS) {
      return NextResponse.json({ error: `Máximo de ${MAX_BANNERS} banners.` }, { status: 400 })
    }

    const formData = await req.formData()
    const image = formData.get("image") as File | null
    if (!image) return NextResponse.json({ error: "image é obrigatória" }, { status: 400 })

    const blob = await put(`hero-banners/${Date.now()}-${image.name}`, image, { access: "public" })

    const { rows: maxOrder } = await pool.query(`SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM hero_banners`)
    const { rows } = await pool.query(
      "INSERT INTO hero_banners (image_url, display_order) VALUES ($1, $2) RETURNING id, image_url, display_order",
      [blob.url, maxOrder[0].next]
    )

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/hero-banners:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
