import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

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

    const { rows } = await pool.query(`
      INSERT INTO wa_contacts (name, phone)
      VALUES ($1, $2)
      RETURNING id, jid, name, phone, created_at AS "createdAt"
    `, [name.trim(), phone.replace(/\D/g, "").trim()])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
