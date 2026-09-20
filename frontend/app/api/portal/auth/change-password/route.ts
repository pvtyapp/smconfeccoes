import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest, signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

export async function POST(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { currentPassword, newPassword } = await req.json() as { currentPassword: string; newPassword: string }
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Preencha a senha atual e a nova senha" }, { status: 400 })
    }

    const { rows } = await pool.query(`SELECT password_hash FROM client_accounts WHERE id = $1`, [session.clientAccountId])
    const account = rows[0]
    if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

    const ok = await bcrypt.compare(currentPassword, account.password_hash)
    if (!ok) return NextResponse.json({ error: "Senha atual incorreta" }, { status: 401 })

    const newHash = await bcrypt.hash(newPassword, 10)
    await pool.query(
      `UPDATE client_accounts SET password_hash = $1, must_change_password = false WHERE id = $2`,
      [newHash, session.clientAccountId]
    )

    // Reemite o cookie já com mustChangePassword false — sem isso o portal
    // continuaria travado na tela de troca até a sessão antiga expirar.
    const token = await signClientSession({
      clientAccountId: session.clientAccountId, contactId: session.contactId, name: session.name,
      mustChangePassword: false,
    })
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    })
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
