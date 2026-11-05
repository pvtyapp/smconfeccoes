import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { normalizePhone, findContactByPhone } from "@/lib/portal/phone"
import { consumeOtp } from "@/lib/portal/otp"
import { hasConcludedOrderHistory } from "@/lib/portal/history"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { signClientSession, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/clientSession"
import { montarCarrinho, garantirColunasSolicitacao, resumoCarrinho, aprovacaoCadastroLigada } from "@/lib/portal/pedidoSite"

// Criar conta (PIV 05/11): nome + WhatsApp + senha, confirma o código que chega
// no WhatsApp e a conta JÁ FICA ATIVA, logada. A aprovação manual virou uma
// trava que liga em Configurações → "Cadastro no site" (portal_aprovacao_cadastro);
// ligada, quem nunca comprou cai em /dashboard/formularios com a senha escolhida
// e o pedido do site guardados, e a conta nasce quando alguém aprova.
export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, code, password, salesChannels, itens, dtfMetros } = await req.json() as {
      name: string; phone: string; code: string; password: string; salesChannels?: string[]
      itens?: { variantId: string; qty: number }[]; dtfMetros?: number
    }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })
    if (!password || password.length < 4) return NextResponse.json({ error: "A senha precisa ter pelo menos 4 letras ou números" }, { status: 400 })

    const verified = await consumeOtp(phone, code ?? "", "signup")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const existing = await findContactByPhone(phone)
    if (existing) {
      const { rows } = await pool.query(`SELECT 1 FROM client_accounts WHERE contact_id = $1`, [existing.id])
      if (rows.length) return NextResponse.json({ error: "Já existe conta pra esse WhatsApp. Faça login." }, { status: 409 })
    }
    const hasHistory = existing ? await hasConcludedOrderHistory(existing.id) : false
    const precisaAprovar = !hasHistory && await aprovacaoCadastroLigada()

    // Número já conhecido (com ou sem o 9) reaproveita o cadastro: nunca abrir
    // um 2º contato pro mesmo WhatsApp (caso Dayane/Luiz Henrique).
    let contact: { id: number; jid: string; phone_jid: string | null }
    if (existing) {
      await pool.query(`UPDATE wa_contacts SET nome_cadastro = $1, updated_at = NOW() WHERE id = $2`, [name.trim(), existing.id])
      contact = existing
    } else {
      const jid = `${phone}@s.whatsapp.net`
      const { rows } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, nome_cadastro, phone, phone_jid)
         VALUES ($1, $2, $2, $3, $1)
         ON CONFLICT (jid) DO UPDATE SET nome_cadastro = $2, updated_at = NOW()
         RETURNING id, jid, phone_jid`,
        [jid, name.trim(), phone]
      )
      contact = rows[0]
    }

    const passwordHash = await bcrypt.hash(password, 10)

    if (precisaAprovar) {
      const carrinho = await montarCarrinho(pool, itens ?? [], dtfMetros ?? 0)
      const temCarrinho = carrinho.itens.length > 0 || carrinho.dtfMetros > 0
      const channels = Array.isArray(salesChannels) ? salesChannels.filter((c) => typeof c === "string" && c.trim()) : []
      await garantirColunasSolicitacao()
      const { rows: pending } = await pool.query(
        `SELECT id FROM fornecedor_solicitacoes WHERE phone = $1 AND status = 'pendente' ORDER BY id DESC LIMIT 1`, [phone]
      )
      if (pending[0]) {
        await pool.query(
          `UPDATE fornecedor_solicitacoes SET name = $1, contact_id = $2, password_hash = $3,
             sales_channels = COALESCE($4, sales_channels),
             carrinho = CASE WHEN $5::jsonb IS NULL THEN carrinho ELSE $5::jsonb END
           WHERE id = $6`,
          [name.trim(), contact.id, passwordHash, channels.length ? channels : null, temCarrinho ? JSON.stringify(carrinho) : null, pending[0].id]
        )
      } else {
        await pool.query(
          `INSERT INTO fornecedor_solicitacoes (name, phone, contact_id, sales_channels, carrinho, password_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
          [name.trim(), phone, contact.id, channels, temCarrinho ? JSON.stringify(carrinho) : null, passwordHash]
        )
      }
      const firstName = name.trim().split(" ")[0]
      await sendAndSave(contact.id, contact.phone_jid || contact.jid, temCarrinho
        ? `Oi, ${firstName}! Recebemos seu cadastro e seu pedido 📋\n\n${resumoCarrinho(carrinho)}\n\nNossa equipe confere e, assim que aprovar, seu pedido entra na fila e a gente te chama aqui pra combinar pagamento e frete. 😊`
        : `Oi, ${firstName}! Recebemos seu cadastro 📋\n\nNossa equipe confere e te avisa por aqui assim que aprovar. 😊`
      ).catch(() => {})
      return NextResponse.json({ pending: true })
    }

    const { rows: accountRows } = await pool.query(
      `INSERT INTO client_accounts (contact_id, password_hash, last_login_at) VALUES ($1, $2, NOW()) RETURNING id`,
      [contact.id, passwordHash]
    )

    const token = await signClientSession({ clientAccountId: accountRows[0].id, contactId: contact.id, name: name.trim() })
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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
