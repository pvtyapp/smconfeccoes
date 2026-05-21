import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
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
      ORDER BY updated_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
