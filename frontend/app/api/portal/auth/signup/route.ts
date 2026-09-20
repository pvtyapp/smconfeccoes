import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { consumeOtp } from "@/lib/portal/otp"
import { hasConcludedOrderHistory } from "@/lib/portal/history"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"

export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, code, password } =
      await req.json() as { name: string; phone: string; code: string; password?: string }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    const verified = await consumeOtp(phone, code ?? "", "signup")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    // hasHistory decide o caminho — recalculado aqui (nunca confia no que o
    // front achava antes do código), mesmo critério do request-code.
    const existingContact = await findContactByPhone(phone)
    const hasHistory = existingContact ? await hasConcludedOrderHistory(existingContact.id) : false

    // Sem histórico: WhatsApp já está confirmado (acabou de passar no
    // código), mas conta só nasce quando o admin aprovar — vira solicitação
    // pendente em /dashboard/formularios, igual o formulário "Quero comprar
    // com vocês". Nunca cria client_accounts aqui, nunca pede senha (a senha
    // temporária só existe na hora da aprovação, ver /api/formularios/[id]/approve).
    if (!hasHistory) {
      const jid = `${phone}@s.whatsapp.net`
      const { rows: upserted } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, nome_cadastro, phone, phone_jid)
         VALUES ($1, $2, $2, $3, $1)
         ON CONFLICT (jid) DO UPDATE SET nome_cadastro = $2, updated_at = NOW()
         RETURNING id, jid, phone_jid`,
        [jid, name.trim(), phone]
      )
      const contact = upserted[0]

      const { rows: pending } = await pool.query(
        `SELECT 1 FROM fornecedor_solicitacoes WHERE phone = $1 AND status = 'pendente'`, [phone]
      )
      if (!pending.length) {
        await pool.query(
          `INSERT INTO fornecedor_solicitacoes (name, phone, contact_id) VALUES ($1, $2, $3)`,
          [name.trim(), phone, contact.id]
        )
      }

      const firstName = name.trim().split(" ")[0]
      await sendAndSave(
        contact.id, contact.phone_jid || contact.jid,
        `Oi, ${firstName}! Recebemos sua solicitação de acesso 📋\n\nJá confirmamos seu WhatsApp — agora é só aguardar, nossa equipe analisa e te avisa por aqui assim que aprovar. 😊`
      ).catch(() => {})

      return NextResponse.json({ pending: true })
    }

    // Com histórico: cadastro direto, senha escolhida agora, já loga.
    if (!password || password.length < 1) return NextResponse.json({ error: "Informe uma senha" }, { status: 400 })

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(`UPDATE wa_contacts SET nome_cadastro = $1, updated_at = NOW() WHERE id = $2`, [name.trim(), existingContact!.id])

      const { rows: existingAccount } = await client.query(
        `SELECT 1 FROM client_accounts WHERE contact_id = $1`, [existingContact!.id]
      )
      if (existingAccount.length) {
        await client.query("ROLLBACK")
        return NextResponse.json({ error: "Já existe conta pra esse WhatsApp. Faça login." }, { status: 409 })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const { rows: accountRows } = await client.query(
        `INSERT INTO client_accounts (contact_id, password_hash, last_login_at)
         VALUES ($1, $2, NOW()) RETURNING id`,
        [existingContact!.id, passwordHash]
      )

      await client.query("COMMIT")

      const token = await signClientSession({
        clientAccountId: accountRows[0].id,
        contactId: existingContact!.id,
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
