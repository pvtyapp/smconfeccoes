import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        lifecycle_state AS state,
        COUNT(*)        AS total
      FROM wa_contacts
      GROUP BY lifecycle_state
      ORDER BY total DESC
    `)

    const { rows: total } = await pool.query(`SELECT COUNT(*) AS total FROM wa_contacts`)

    return NextResponse.json({ total: Number(total[0].total), byState: rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
