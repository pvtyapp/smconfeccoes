import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest()
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const { id } = await params
    const { rows } = await pool.query(
      `UPDATE fornecedor_solicitacoes
       SET status = 'recusado', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND status = 'pendente'
       RETURNING id`,
      [session.name, id]
    )
    if (rows.length === 0) return NextResponse.json({ error: "Solicitação não encontrada ou já revisada" }, { status: 409 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
