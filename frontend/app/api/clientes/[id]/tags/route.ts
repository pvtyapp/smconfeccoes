import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const [tagsRes, offersRes] = await Promise.all([
      pool.query(`
        SELECT id, tag, value, source, created_at AS "createdAt"
        FROM wa_contact_tags
        WHERE contact_id = $1
        ORDER BY created_at DESC
      `, [id]),
      pool.query(`
        SELECT id, offer_type AS "offerType", offered_at AS "offeredAt"
        FROM wa_contact_offers
        WHERE contact_id = $1
        ORDER BY offered_at DESC
        LIMIT 20
      `, [id]),
    ])
    return NextResponse.json({ tags: tagsRes.rows, offers: offersRes.rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { tag, value = "", source = "manual" } = await req.json()
    if (!tag) return NextResponse.json({ error: "tag obrigatório" }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO wa_contact_tags (contact_id, tag, value, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contact_id, tag, value) DO NOTHING
      RETURNING id, tag, value, source, created_at AS "createdAt"
    `, [id, tag.trim(), value.trim(), source])

    return NextResponse.json(rows[0] ?? { ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { tagId } = await req.json()
    if (!tagId) return NextResponse.json({ error: "tagId obrigatório" }, { status: 400 })

    await pool.query(
      `DELETE FROM wa_contact_tags WHERE id = $1 AND contact_id = $2`,
      [tagId, id]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
