import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { consumeOtp } from "@/lib/portal/otp"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, code, password } =
      await req.json() as { name: string; phone: string; code: string; password: string }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })
    if (!password || password.length < 1) return NextResponse.json({ error: "Informe uma senha" }, { status: 400 })

    const verified = await consumeOtp(phone, code ?? "", "signup")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      let contact = await findContactByPhone(phone)
      if (!contact) {
        const jid = `${phone}@s.whatsapp.net`
        const { rows } = await client.query(
          `INSERT INTO wa_contacts (jid, name, nome_cadastro, phone, phone_jid)
           VALUES ($1, $2, $2, $3, $1)
           ON CONFLICT (jid) DO UPDATE SET updated_at = NOW()
           RETURNING id, name, jid, phone_jid`,
          [jid, name.trim(), phone]
        )
        contact = rows[0]
      } else {
        await client.query(`UPDATE wa_contacts SET nome_cadastro = $1, updated_at = NOW() WHERE id = $2`, [name.trim(), contact.id])
      }

      const { rows: existingAccount } = await client.query(
        `SELECT 1 FROM client_accounts WHERE contact_id = $1`, [contact!.id]
      )
      if (existingAccount.length) {
        await client.query("ROLLBACK")
        return NextResponse.json({ error: "Já existe conta pra esse WhatsApp. Faça login." }, { status: 409 })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const { rows: accountRows } = await client.query(
        `INSERT INTO client_accounts (contact_id, password_hash, last_login_at)
         VALUES ($1, $2, NOW()) RETURNING id`,
        [contact!.id, passwordHash]
      )

      await client.query("COMMIT")

      const token = await signClientSession({
        clientAccountId: accountRows[0].id,
        contactId: contact!.id,
        name: name.trim(),
      })
      const res = NextResponse.json({ ok: true, name: name.trim() })
      res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: MAX_AGE_SECONDS,
        path: "/",
      })
      return res
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
