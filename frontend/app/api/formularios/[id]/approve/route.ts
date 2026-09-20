import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"
import { findContactByPhone } from "@/lib/portal/phone"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

function generateTempPassword(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// "5516991234567" → "(16) 99123-4567" — o mesmo formato que o campo de
// WhatsApp do login usa, pra bater exatamente com o que a pessoa vai digitar.
function formatPhoneBR(phone: string): string {
  const local = phone.startsWith("55") ? phone.slice(2) : phone
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  return local
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest()
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const { id } = await params
    const { rows } = await pool.query(
      `SELECT id, name, phone, status FROM fornecedor_solicitacoes WHERE id = $1`, [id]
    )
    const solicitacao = rows[0]
    if (!solicitacao) return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 })
    if (solicitacao.status !== "pendente") return NextResponse.json({ error: "Solicitação já foi revisada" }, { status: 409 })

    let contact = await findContactByPhone(solicitacao.phone)
    if (!contact) {
      const jid = `${solicitacao.phone}@s.whatsapp.net`
      const { rows: created } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, nome_cadastro, phone, phone_jid)
         VALUES ($1, $2, $2, $3, $1)
         ON CONFLICT (jid) DO UPDATE SET updated_at = NOW()
         RETURNING id, name, jid, phone_jid`,
        [jid, solicitacao.name, solicitacao.phone]
      )
      contact = created[0]
    }

    await pool.query(
      `UPDATE wa_contacts SET fornecedor_fixo_since = NOW(), updated_at = NOW() WHERE id = $1`,
      [contact!.id]
    )
    await pool.query(
      `UPDATE fornecedor_solicitacoes
       SET status = 'aprovado', contact_id = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [contact!.id, session.name, id]
    )

    // Só gera credencial nova se a pessoa ainda não tem conta — evita
    // sobrescrever a senha de alguém que já criou a própria (ex: comprou
    // direto e depois preencheu o formulário por engano).
    const { rows: existingAccount } = await pool.query(
      `SELECT id FROM client_accounts WHERE contact_id = $1`, [contact!.id]
    )

    const firstName = solicitacao.name.split(" ")[0]

    if (existingAccount.length === 0) {
      const tempPassword = generateTempPassword()
      const passwordHash = await bcrypt.hash(tempPassword, 10)
      await pool.query(
        `INSERT INTO client_accounts (contact_id, password_hash, must_change_password)
         VALUES ($1, $2, true)`,
        [contact!.id, passwordHash]
      )

      await sendAndSave(
        contact!.id, contact!.jid,
        `Oi, ${firstName}! Seu acesso pra comprar com a *SM Confecções* foi liberado 🎉\n\n` +
        `Pra entrar no site (${formatPhoneBR(solicitacao.phone)}):\n` +
        `📱 WhatsApp: *${formatPhoneBR(solicitacao.phone)}*\n` +
        `🔑 Senha: *${tempPassword}*\n\n` +
        `No primeiro acesso você vai precisar trocar essa senha. Entre em: https://smconfeccoes.com.br/portal/login`
      )
    } else {
      await sendAndSave(
        contact!.id, contact!.jid,
        `Oi, ${firstName}! Seu acesso pra comprar com a *SM Confecções* foi liberado 🎉\n\nJá pode fazer seu pedido pelo site: https://smconfeccoes.com.br/catalogo`
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
