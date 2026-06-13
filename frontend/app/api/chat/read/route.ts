import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { contactId } = await req.json()
    if (!contactId) return NextResponse.json({ error: "contactId obrigatório" }, { status: 400 })

    await pool.query(`
      UPDATE wa_messages
      SET read_at = NOW()
      WHERE contact_id = $1 AND direction = 'in' AND read_at IS NULL
    `, [contactId])

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
