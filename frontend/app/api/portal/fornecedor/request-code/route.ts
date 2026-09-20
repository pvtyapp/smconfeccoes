import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { sendOtpCode } from "@/lib/portal/otp"

// Confirma que quem preencheu "Quero comprar com vocês" é dona mesmo desse
// WhatsApp antes de qualquer solicitação entrar na fila — mesmo princípio do
// cadastro normal (ver /api/portal/auth/request-code). Antes, esse formulário
// aceitava qualquer número digitado, sem provar nada.
export async function POST(req: Request) {
  try {
    const { phone: rawPhone } = await req.json() as { phone: string }
    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })

    const contact = await findContactByPhone(phone)
    if (contact) {
      const { rows: acct } = await pool.query(`SELECT 1 FROM client_accounts WHERE contact_id = $1`, [contact.id])
      if (acct.length) return NextResponse.json({ error: "Você já tem uma conta com esse WhatsApp — faça login." }, { status: 409 })
    }

    const result = await sendOtpCode(phone, "signup")
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
