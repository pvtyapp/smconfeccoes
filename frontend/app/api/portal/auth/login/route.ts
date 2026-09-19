import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

export async function POST(req: Request) {
  try {
    const { phone: rawPhone, password } = await req.json() as { phone: string; password: string }
    const phone = normalizePhone(rawPhone ?? "")
    if (!phone || !password) {
      return NextResponse.json({ error: "WhatsApp ou senha incorretos" }, { status: 401 })
    }

    const contact = await findContactByPhone(phone)
    if (!contact) return NextResponse.json({ error: "WhatsApp ou senha incorretos" }, { status: 401 })

    const { rows } = await pool.query(
      `SELECT id, password_hash FROM client_accounts WHERE contact_id = $1`,
      [contact.id]
    )
    const account = rows[0]
    if (!account) return NextResponse.json({ error: "WhatsApp ou senha incorretos" }, { status: 401 })

    const ok = await bcrypt.compare(password, account.password_hash)
    if (!ok) return NextResponse.json({ error: "WhatsApp ou senha incorretos" }, { status: 401 })

    await pool.query(`UPDATE client_accounts SET last_login_at = NOW() WHERE id = $1`, [account.id])

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
