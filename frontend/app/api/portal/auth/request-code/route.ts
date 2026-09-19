import { NextResponse } from "next/server"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { sendOtpCode, type OtpPurpose } from "@/lib/portal/otp"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { phone: rawPhone, purpose } = await req.json() as { phone: string; purpose: OtpPurpose }
    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (purpose !== "signup" && purpose !== "reset_password") {
      return NextResponse.json({ error: "Solicitação inválida" }, { status: 400 })
    }

    if (purpose === "reset_password") {
      const contact = await findContactByPhone(phone)
      if (!contact) return NextResponse.json({ error: "Não encontramos conta com esse WhatsApp" }, { status: 404 })
      const { rows } = await pool.query(`SELECT 1 FROM client_accounts WHERE contact_id = $1`, [contact.id])
      if (!rows.length) return NextResponse.json({ error: "Não encontramos conta com esse WhatsApp" }, { status: 404 })
    }

    const result = await sendOtpCode(phone, purpose)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
