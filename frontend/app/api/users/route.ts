import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"

export async function GET() {
  const session = await getSessionFromRequest()
  if (!session?.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS funcao TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_admin_enabled BOOLEAN NOT NULL DEFAULT true`).catch(() => {})

  const { rows } = await pool.query(`
    SELECT id, name, login, phone, funcao, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
           chatbot_admin_enabled AS "chatbotAdminEnabled",
           active, created_at AS "createdAt"
    FROM users
    ORDER BY name ASC
  `)
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const session = await getSessionFromRequest()
  if (!session?.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS funcao TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_admin_enabled BOOLEAN NOT NULL DEFAULT true`).catch(() => {})

  try {
    const { name, login, password, phone, funcao, isAdmin, allowedPages, chatbotAdminEnabled } = await req.json() as {
      name: string; login: string; password: string; phone?: string; funcao?: string
      isAdmin?: boolean; allowedPages?: string[]; chatbotAdminEnabled?: boolean
    }

    if (!name?.trim() || !login?.trim() || !password) {
      return NextResponse.json({ error: "Nome, login e senha são obrigatórios" }, { status: 400 })
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "Senha muito curta" }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const { rows } = await pool.query(`
      INSERT INTO users (name, login, password_hash, phone, funcao, is_admin, allowed_pages, chatbot_admin_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, name, login, phone, funcao, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
                chatbot_admin_enabled AS "chatbotAdminEnabled", active
    `, [
      name.trim(),
      login.trim(),
      passwordHash,
      phone?.replace(/\D/g, "") || null,
      funcao?.trim() || null,
      isAdmin ?? false,
      isAdmin ? [] : (allowedPages ?? []),
      chatbotAdminEnabled ?? true,
    ])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("users_login_key")) {
      return NextResponse.json({ error: "Esse login já está em uso" }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
