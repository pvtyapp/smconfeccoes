import { NextResponse } from "next/server"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { sendOtpCode, type OtpPurpose } from "@/lib/portal/otp"
import { hasConcludedOrderHistory } from "@/lib/portal/history"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { phone: rawPhone, purpose, name } = await req.json() as { phone: string; purpose: OtpPurpose; name?: string }
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

    // Cadastro sempre passa por código agora — quem já comprou antes (pedido
    // concluído) cria a conta na hora depois de confirmar; quem nunca comprou
    // também confirma o WhatsApp primeiro, só que vira solicitação pendente
    // em vez de conta (revisada em /dashboard/formularios). Antes, quem não
    // tinha histórico nunca provava que o número era dela — qualquer um
    // digitava qualquer WhatsApp e a solicitação entrava sem verificação.
    let hasHistory = false
    if (purpose === "signup") {
      const contact = await findContactByPhone(phone)

      if (contact) {
        const { rows: acct } = await pool.query(`SELECT 1 FROM client_accounts WHERE contact_id = $1`, [contact.id])
        if (acct.length) return NextResponse.json({ error: "Você já tem uma conta com esse WhatsApp — faça login." }, { status: 409 })
      }

      hasHistory = contact ? await hasConcludedOrderHistory(contact.id) : false
    }

    const result = await sendOtpCode(phone, purpose)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 })
    return NextResponse.json({ ok: true, hasHistory })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
