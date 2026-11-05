import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { sendOtpCode, consumeOtp } from "@/lib/portal/otp"
import { hasConcludedOrderHistory } from "@/lib/portal/history"
import { signVerifiedPhone } from "@/lib/portal/verifiedPhone"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

// Entrar só com WhatsApp + código (PIV 05/11: "o usuário é muito burro, não lê
// direito"). Um caminho só pra todo mundo, sem senha:
//   step "codigo"    → manda o código de 6 números no WhatsApp
//   step "confirmar" → confere o código e:
//      - já tem conta              → loga
//      - já comprou (sem conta)    → cria a conta na hora e loga
//      - nunca comprou             → devolve { novo, token } pro passo "nome + onde vende"
//        (cliente novo continua passando por aprovação, ver /api/portal/solicitacao)
// Usa o purpose "signup" do OTP: é o código de "confirmar o WhatsApp", o mesmo
// que o cadastro já usava, sem precisar mexer na constraint chk_otp_purpose.
export async function POST(req: Request) {
  try {
    const { step, phone: rawPhone, code } = await req.json() as { step: "codigo" | "confirmar"; phone: string; code?: string }
    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "Confere o número: tem que ter DDD e 9 dígitos." }, { status: 400 })

    if (step === "codigo") {
      const result = await sendOtpCode(phone, "signup")
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 })
      return NextResponse.json({ ok: true })
    }

    if (step !== "confirmar") return NextResponse.json({ error: "Solicitação inválida" }, { status: 400 })

    const verified = await consumeOtp(phone, String(code ?? "").replace(/\D/g, ""), "signup")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const contact = await findContactByPhone(phone)
    let accountId: number | null = null

    if (contact) {
      const { rows } = await pool.query(`SELECT id FROM client_accounts WHERE contact_id = $1`, [contact.id])
      if (rows[0]) {
        accountId = rows[0].id
      } else if (await hasConcludedOrderHistory(contact.id)) {
        // Senha aleatória só pra cumprir o NOT NULL: o acesso é pelo código.
        // A trava trg_trava_conta_mesmo_fone (se já gravada) barra 2ª conta no mesmo número.
        const hash = await bcrypt.hash(randomBytes(24).toString("hex"), 10)
        const { rows: created } = await pool.query(
          `INSERT INTO client_accounts (contact_id, password_hash) VALUES ($1, $2) RETURNING id`,
          [contact.id, hash]
        )
        accountId = created[0].id
      }
    }

    if (!contact || accountId === null) {
      return NextResponse.json({ novo: true, token: await signVerifiedPhone(phone) })
    }

    // Quem entra pelo código não precisa trocar senha temporária (nem usa senha).
    await pool.query(
      `UPDATE client_accounts SET last_login_at = NOW(), must_change_password = false WHERE id = $1`,
      [accountId]
    )

    const name = contact.name ?? "Cliente"
    const token = await signClientSession({ clientAccountId: accountId, contactId: contact.id, name, mustChangePassword: false })
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
