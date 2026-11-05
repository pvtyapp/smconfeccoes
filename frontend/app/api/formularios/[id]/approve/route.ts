import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"
import { findContactByPhone } from "@/lib/portal/phone"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { randomBytes } from "crypto"
import { garantirColunaCarrinho, criarPedidoDoCarrinho, criarPedidoDtfSite, type CarrinhoSite } from "@/lib/portal/pedidoSite"

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
    await garantirColunaCarrinho()
    const { rows } = await pool.query(
      `SELECT id, name, phone, status, carrinho FROM fornecedor_solicitacoes WHERE id = $1`, [id]
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

    // Só cria conta se a pessoa ainda não tem. Sem senha temporária desde o site
    // novo (PIV 05/11): o acesso é pelo WhatsApp + código (/api/portal/auth/entrar),
    // a senha aleatória só cumpre o NOT NULL.
    const { rows: existingAccount } = await pool.query(
      `SELECT id FROM client_accounts WHERE contact_id = $1`, [contact!.id]
    )
    if (existingAccount.length === 0) {
      const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10)
      await pool.query(
        `INSERT INTO client_accounts (contact_id, password_hash, must_change_password) VALUES ($1, $2, false)`,
        [contact!.id, passwordHash]
      )
    }

    // Pedido guardado junto da solicitação (feito no site antes da aprovação) nasce agora.
    const carrinho = solicitacao.carrinho as CarrinhoSite | null
    const numeros: string[] = []
    if (carrinho) {
      const ped = await criarPedidoDoCarrinho(pool, contact!.id, carrinho.itens ?? [],
        `Pedido feito no site antes da aprovação do cadastro (aprovado por ${session.name}). Conferir estoque antes de separar.`)
      if (ped) numeros.push(ped)
      if (carrinho.dtfMetros > 0) numeros.push(await criarPedidoDtfSite(pool, contact!.id, carrinho.dtfMetros))
    }

    const firstName = solicitacao.name.split(" ")[0]
    const comoEntrar = `Pra entrar no site é só colocar seu WhatsApp (${formatPhoneBR(solicitacao.phone)}) e o código que chega aqui: https://smconfeccoes.com.br`
    await sendAndSave(
      contact!.id, contact!.phone_jid || contact!.jid,
      numeros.length
        ? `Oi, ${firstName}! Seu cadastro na *SM Confecções* foi aprovado 🎉

Seu pedido já entrou na fila (${numeros.join(", ")}). Já já a gente te chama aqui pra combinar pagamento e frete.

${comoEntrar}`
        : `Oi, ${firstName}! Seu cadastro na *SM Confecções* foi aprovado 🎉

${comoEntrar}`
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
