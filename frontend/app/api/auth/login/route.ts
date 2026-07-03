import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json() as { email: string; password: string }

    const AUTH_EMAIL    = process.env.AUTH_EMAIL
    const AUTH_PASSWORD = process.env.AUTH_PASSWORD
    const AUTH_SECRET   = process.env.AUTH_SECRET

    if (!AUTH_SECRET || !AUTH_EMAIL || !AUTH_PASSWORD) {
      return NextResponse.json({ error: "Configuração de autenticação incompleta no servidor" }, { status: 500 })
    }

    if (email !== AUTH_EMAIL || password !== AUTH_PASSWORD) {
      return NextResponse.json({ error: "Email ou senha incorretos" }, { status: 401 })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set("smc_session", AUTH_SECRET, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 60 * 24 * 30,
      path:     "/",
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
