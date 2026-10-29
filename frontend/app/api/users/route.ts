import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"
import { garantirColunasAcesso } from "@/lib/acesso"

export async function GET() {
  const session = await getSessionFromRequest()
  if (!session?.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS funcao TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_admin_enabled BOOLEAN NOT NULL DEFAULT true`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_commands TEXT[] NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_subscriptions TEXT[] NOT NULL DEFAULT '{}'`).catch(() => {})
  await garantirColunasAcesso()

  const { rows } = await pool.query(`
    SELECT id, name, login, phone, funcao, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
           chatbot_admin_enabled AS "chatbotAdminEnabled", chatbot_commands AS "chatbotCommands",
           notification_subscriptions AS "notificationSubscriptions",
           ver_preco AS "verPreco", ver_financeiro AS "verFinanceiro",
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chatbot_commands TEXT[] NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_subscriptions TEXT[] NOT NULL DEFAULT '{}'`).catch(() => {})
  await garantirColunasAcesso()

  try {
    const { name, login, password, phone, funcao, isAdmin, allowedPages, chatbotAdminEnabled, chatbotCommands, notificationSubscriptions, verPreco, verFinanceiro } = await req.json() as {
      name: string; login: string; password: string; phone?: string; funcao?: string
      isAdmin?: boolean; allowedPages?: string[]; chatbotAdminEnabled?: boolean; chatbotCommands?: string[]
      notificationSubscriptions?: string[]; verPreco?: boolean; verFinanceiro?: boolean
    }

    if (!name?.trim() || !login?.trim() || !password) {
      return NextResponse.json({ error: "Nome, login e senha são obrigatórios" }, { status: 400 })
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "Senha muito curta" }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const { rows } = await pool.query(`
      INSERT INTO users (name, login, password_hash, phone, funcao, is_admin, allowed_pages, chatbot_admin_enabled, chatbot_commands, notification_subscriptions, ver_preco, ver_financeiro)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, name, login, phone, funcao, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
                chatbot_admin_enabled AS "chatbotAdminEnabled", chatbot_commands AS "chatbotCommands",
                notification_subscriptions AS "notificationSubscriptions",
                ver_preco AS "verPreco", ver_financeiro AS "verFinanceiro", active
    `, [
      name.trim(),
      login.trim(),
      passwordHash,
      phone?.replace(/\D/g, "") || null,
      funcao?.trim() || null,
      isAdmin ?? false,
      isAdmin ? [] : (allowedPages ?? []),
      chatbotAdminEnabled ?? true,
      isAdmin ? [] : (chatbotCommands ?? []),
      notificationSubscriptions ?? [],
      // Usuário novo nasce SEM ver valores (PIV 28/10); admin vê tudo de qualquer jeito.
      verPreco ?? false,
      verFinanceiro ?? false,
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
