import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { signSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/session"
import { garantirColunasAcesso } from "@/lib/acesso"

export async function POST(req: Request) {
  try {
    const { login, password } = await req.json() as { login: string; password: string }

    if (!login || !password) {
      return NextResponse.json({ error: "Login e senha são obrigatórios" }, { status: 400 })
    }

    await garantirColunasAcesso()
    const { rows } = await pool.query(
      `SELECT id, name, login, password_hash, funcao, is_admin, allowed_pages, active, ver_preco, ver_financeiro
       FROM users WHERE login = $1`,
      [login]
    )
    const user = rows[0]

    if (!user || !user.active) {
      return NextResponse.json({ error: "Login ou senha incorretos" }, { status: 401 })
    }

    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) {
      return NextResponse.json({ error: "Login ou senha incorretos" }, { status: 401 })
    }

    const token = await signSession({
      userId: user.id,
      login: user.login,
      name: user.name,
      funcao: user.funcao ?? null,
      isAdmin: user.is_admin,
      allowedPages: user.allowed_pages ?? [],
      verFinanceiro: user.is_admin || !!user.ver_financeiro,
    })

    const res = NextResponse.json({
      ok: true,
      user: {
        name: user.name, login: user.login, isAdmin: user.is_admin, allowedPages: user.allowed_pages ?? [],
        verPreco: user.is_admin || !!user.ver_preco, verFinanceiro: user.is_admin || !!user.ver_financeiro,
      },
    })
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   MAX_AGE_SECONDS,
      path:     "/",
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
