import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id            SERIAL PRIMARY KEY,
        product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        color         TEXT,
        image_url     TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id)`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
