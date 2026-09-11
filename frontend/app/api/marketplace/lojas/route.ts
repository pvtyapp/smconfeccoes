import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Lojas do marketplace (ex: "Loja 1", "Loja 2") — só um nome editável, pra
// saber pra qual conta/loja uma separação tá saindo. Nada a ver com canal
// (Shopee/Mercado Livre) — isso fica gravado como snapshot em
// marketplace_separations.origin na hora de confirmar (ver /confirm).
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome, created_at AS "createdAt" FROM marketplace_lojas ORDER BY nome
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { nome } = await req.json() as { nome?: string }
    if (!nome?.trim()) return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 })
    const { rows } = await pool.query(`
      INSERT INTO marketplace_lojas (nome) VALUES ($1)
      RETURNING id, nome, created_at AS "createdAt"
    `, [nome.trim()])
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("duplicate key")) return NextResponse.json({ error: "Já existe uma loja com esse nome" }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
