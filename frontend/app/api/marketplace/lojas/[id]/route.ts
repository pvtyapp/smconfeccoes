import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Renomear — separações antigas já têm o nome antigo gravado em
// `origin` (snapshot no momento da confirmação), então renomear a loja
// aqui não reescreve histórico, só afeta separações novas pra frente.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { nome } = await req.json() as { nome?: string }
    if (!nome?.trim()) return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 })
    const { rows } = await pool.query(`
      UPDATE marketplace_lojas SET nome = $1 WHERE id = $2
      RETURNING id, nome, created_at AS "createdAt"
    `, [nome.trim(), id])
    if (!rows[0]) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("duplicate key")) return NextResponse.json({ error: "Já existe uma loja com esse nome" }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
