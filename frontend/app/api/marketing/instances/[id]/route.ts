import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PATCH — liga/desliga um número sem apagar o cadastro (útil pra tirar um
// número do rodízio temporariamente, ex: vai trocar de chip).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { active } = await req.json() as { active: boolean }
    await pool.query(`UPDATE marketing_instances SET active = $1 WHERE id = $2`, [active, id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE — só remove o cadastro daqui (deixa de entrar no rodízio de
// campanhas). Não apaga a instância no Evolution nem desconecta o número.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query(`DELETE FROM marketing_instances WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
