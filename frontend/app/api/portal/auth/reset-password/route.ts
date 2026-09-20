import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { consumeOtp } from "@/lib/portal/otp"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

export async function POST(req: Request) {
  try {
    const { phone: rawPhone, code, password } =
      await req.json() as { phone: string; code: string; password: string }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!password) return NextResponse.json({ error: "Informe a nova senha" }, { status: 400 })

    const verified = await consumeOtp(phone, code ?? "", "reset_password")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const contact = await findContactByPhone(phone)
    if (!contact) return NextResponse.json({ error: "Não encontramos conta com esse WhatsApp" }, { status: 404 })

    const { rows } = await pool.query(`SELECT id FROM client_accounts WHERE contact_id = $1`, [contact.id])
    const account = rows[0]
    if (!account) return NextResponse.json({ error: "Não encontramos conta com esse WhatsApp" }, { status: 404 })

    const passwordHash = await bcrypt.hash(password, 10)
    await pool.query(
      `UPDATE client_accounts SET password_hash = $1, must_change_password = false, last_login_at = NOW() WHERE id = $2`,
      [passwordHash, account.id]
    )

    const name = contact.name ?? "Cliente"
    const token = await signClientSession({ clientAccountId: account.id, contactId: contact.id, name })
    const res = NextResponse.json({ ok: true, name })
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
