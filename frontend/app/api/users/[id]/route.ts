import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest()
  if (!session?.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  try {
    const { id } = await params
    const { name, login, password, phone, isAdmin, allowedPages, active } = await req.json() as {
      name: string; login: string; password?: string; phone?: string
      isAdmin?: boolean; allowedPages?: string[]; active?: boolean
    }

    if (!name?.trim() || !login?.trim()) {
      return NextResponse.json({ error: "Nome e login são obrigatórios" }, { status: 400 })
    }
    if (password && password.length < 4) {
      return NextResponse.json({ error: "Senha muito curta" }, { status: 400 })
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : null

    const { rows } = await pool.query(`
      UPDATE users SET
        name          = $1,
        login         = $2,
        password_hash = COALESCE($3, password_hash),
        phone         = $4,
        is_admin      = $5,
        allowed_pages = $6,
        active        = $7,
        updated_at    = NOW()
      WHERE id = $8
      RETURNING id, name, login, phone, is_admin AS "isAdmin", allowed_pages AS "allowedPages", active
    `, [
      name.trim(),
      login.trim(),
      passwordHash,
      phone?.replace(/\D/g, "") || null,
      isAdmin ?? false,
      isAdmin ? [] : (allowedPages ?? []),
      active ?? true,
      id,
    ])

    if (!rows[0]) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("users_login_key")) {
      return NextResponse.json({ error: "Esse login já está em uso" }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest()
  if (!session?.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  const { id } = await params
  await pool.query(`UPDATE users SET active = false, updated_at = NOW() WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
