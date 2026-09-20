import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, phone, sales_channels AS "salesChannels",
             status, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt", created_at AS "createdAt"
      FROM fornecedor_solicitacoes
      ORDER BY (status = 'pendente') DESC, created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
