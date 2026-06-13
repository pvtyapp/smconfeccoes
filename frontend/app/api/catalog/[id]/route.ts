import { del, put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const withImages = `
  SELECT p.id, p.name, p.image_url, p.display_order, p.description, p.cover_color,
    COALESCE(
      json_agg(json_build_object('id', i.id, 'image_url', i.image_url, 'display_order', i.display_order, 'color', i.color)
        ORDER BY i.display_order ASC) FILTER (WHERE i.id IS NOT NULL), '[]'
    ) AS images
  FROM catalog_products p
  LEFT JOIN catalog_product_images i ON i.product_id = p.id
  WHERE p.id = $1 GROUP BY p.id
`

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows: prod } = await pool.query("SELECT image_url FROM catalog_products WHERE id = $1", [id])
    if (prod.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    const { rows: extras } = await pool.query("SELECT image_url FROM catalog_product_images WHERE product_id = $1", [id])
    await pool.query("DELETE FROM catalog_products WHERE id = $1", [id])
    const urls = [prod[0].image_url, ...extras.map((r: { image_url: string }) => r.image_url)]
    await Promise.allSettled(urls.map((u) => del(u)))
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("DELETE /api/catalog:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const formData = await req.formData()

    const name = (formData.get("name") as string | null)?.trim()
    const description = (formData.get("description") as string | null)?.trim() ?? null
    const coverColor = (formData.get("cover_color") as string | null)?.trim() ?? null
    const newCover = formData.get("cover") as File | null

    if (name) {
      await pool.query(
        "UPDATE catalog_products SET name = $1, description = $2, cover_color = $3 WHERE id = $4",
        [name, description, coverColor, id]
      )
    }

    if (newCover && process.env.BLOB_READ_WRITE_TOKEN) {
      const { rows: old } = await pool.query("SELECT image_url FROM catalog_products WHERE id = $1", [id])
      const blob = await put(`catalog/${Date.now()}-${newCover.name}`, newCover, { access: "public" })
      await pool.query("UPDATE catalog_products SET image_url = $1 WHERE id = $2", [blob.url, id])
      if (old[0]) await del(old[0].image_url).catch(() => null)
    }

    // Delete removed extra images
    const removeIds = (formData.get("remove_images") as string | null)?.split(",").filter(Boolean) ?? []
    if (removeIds.length > 0) {
      const { rows: toRemove } = await pool.query(
        "DELETE FROM catalog_product_images WHERE id = ANY($1) AND product_id = $2 RETURNING image_url",
        [removeIds, id]
      )
      await Promise.allSettled(toRemove.map((r: { image_url: string }) => del(r.image_url)))
    }

    // Add new extra images (no hard limit)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { rows: cnt } = await pool.query("SELECT COUNT(*) FROM catalog_product_images WHERE product_id = $1", [id])
      let order = Number(cnt[0].count)
      let i = 0
      while (true) {
        const extra = formData.get(`image_${i}`) as File | null
        if (!extra) break
        const color = (formData.get(`color_${i}`) as string | null)?.trim() ?? null
        const blob = await put(`catalog/${Date.now()}-${i}-${extra.name}`, extra, { access: "public" })
        await pool.query(
          "INSERT INTO catalog_product_images (product_id, image_url, display_order, color) VALUES ($1, $2, $3, $4)",
          [id, blob.url, order, color]
        )
        order++
        i++
      }
    }

    const { rows } = await pool.query(withImages, [id])
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("PUT /api/catalog:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
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
