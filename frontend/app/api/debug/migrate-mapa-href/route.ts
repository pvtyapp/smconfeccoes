import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário, uso único: atualiza allowed_pages de usuários que ainda
// referenciam o href antigo /dashboard/mapa-producao pro novo /dashboard/mapa-operacao
// (renomeado + movido de grupo no menu).
export async function GET() {
  try {
    const { rows: before } = await pool.query(
      `SELECT id, name, allowed_pages FROM users WHERE '/dashboard/mapa-producao' = ANY(allowed_pages)`
    )
    const { rows: updated } = await pool.query(`
      UPDATE users
      SET allowed_pages = array_replace(allowed_pages, '/dashboard/mapa-producao', '/dashboard/mapa-operacao')
      WHERE '/dashboard/mapa-producao' = ANY(allowed_pages)
      RETURNING id, name, allowed_pages
    `)
    return NextResponse.json({ ok: true, before, updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
