import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { findOrCreateManualContact } from "@/lib/whatsapp/resolveContact"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")

    const { rows } = await pool.query(`
      SELECT
        id,
        jid,
        name,
        phone,
        state,
        state_data   AS "stateData",
        created_at   AS "createdAt",
        updated_at   AS "updatedAt"
      FROM wa_contacts
      ${search ? `WHERE name ILIKE $1 OR phone ILIKE $1` : ""}
      ORDER BY name ASC, updated_at DESC
    `, search ? [`%${search}%`] : [])
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, phone } = body

    if (!name?.trim())  return NextResponse.json({ error: "Nome é obrigatório" },     { status: 400 })
    if (!phone?.trim()) return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 })

    const id = await findOrCreateManualContact(pool, name, phone)
    const { rows } = await pool.query(
      `SELECT id, jid, name, phone, created_at AS "createdAt" FROM wa_contacts WHERE id = $1`,
      [id]
    )

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
