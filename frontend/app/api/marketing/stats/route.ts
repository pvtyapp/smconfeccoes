import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})
    const { rows } = await pool.query(`
      SELECT
        lifecycle_state AS state,
        COUNT(*)        AS total
      FROM wa_contacts
      WHERE linked_user_id IS NULL
      GROUP BY lifecycle_state
      ORDER BY total DESC
    `)

    const { rows: total } = await pool.query(`SELECT COUNT(*) AS total FROM wa_contacts WHERE linked_user_id IS NULL`)

    return NextResponse.json({ total: Number(total[0].total), byState: rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
