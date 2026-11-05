import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { readVerifiedPhone } from "@/lib/portal/verifiedPhone"
import { findContactByPhone } from "@/lib/portal/phone"
import { montarCarrinho, garantirColunaCarrinho, resumoCarrinho } from "@/lib/portal/pedidoSite"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

// Cliente novo no site (PIV 05/11): o WhatsApp já foi confirmado pelo código
// em /api/portal/auth/entrar (token), aqui só entra nome + onde vende + o
// carrinho. Vira solicitação pendente em /dashboard/formularios com o pedido
// guardado junto; ao aprovar, o pedido nasce sozinho (ver approve).
export async function POST(req: Request) {
  try {
    const { token, name, salesChannels, itens, dtfMetros } = await req.json() as {
      token: string; name: string; salesChannels?: string[]
      itens?: { variantId: string; qty: number }[]; dtfMetros?: number
    }
    const phone = await readVerifiedPhone(token ?? "")
    if (!phone) return NextResponse.json({ error: "O código expirou. Coloca seu WhatsApp de novo." }, { status: 401 })
    if (!name?.trim()) return NextResponse.json({ error: "Escreve seu nome pra gente te chamar certo." }, { status: 400 })

    const channels = Array.isArray(salesChannels) ? salesChannels.filter((c) => typeof c === "string" && c.trim()) : []
    const carrinho = await montarCarrinho(pool, itens ?? [], dtfMetros ?? 0)

    // Número já conhecido (com ou sem o 9) reaproveita o cadastro: nunca abrir
    // um 2º contato pro mesmo WhatsApp (caso Dayane/Luiz Henrique).
    const existente = await findContactByPhone(phone)
    let contact: { id: number; jid: string; phone_jid: string | null }
    if (existente) {
      await pool.query(`UPDATE wa_contacts SET nome_cadastro = $1, updated_at = NOW() WHERE id = $2`, [name.trim(), existente.id])
      contact = existente
    } else {
      const jid = `${phone}@s.whatsapp.net`
      const { rows: upserted } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, nome_cadastro, phone, phone_jid)
         VALUES ($1, $2, $2, $3, $1)
         ON CONFLICT (jid) DO UPDATE SET nome_cadastro = $2, updated_at = NOW()
         RETURNING id, jid, phone_jid`,
        [jid, name.trim(), phone]
      )
      contact = upserted[0]
    }

    await garantirColunaCarrinho()
    const temCarrinho = carrinho.itens.length > 0 || carrinho.dtfMetros > 0
    const { rows: pending } = await pool.query(
      `SELECT id FROM fornecedor_solicitacoes WHERE phone = $1 AND status = 'pendente' ORDER BY id DESC LIMIT 1`, [phone]
    )
    if (pending[0]) {
      await pool.query(
        `UPDATE fornecedor_solicitacoes SET name = $1, sales_channels = $2, contact_id = $3,
           carrinho = CASE WHEN $4::jsonb IS NULL THEN carrinho ELSE $4::jsonb END
         WHERE id = $5`,
        [name.trim(), channels, contact.id, temCarrinho ? JSON.stringify(carrinho) : null, pending[0].id]
      )
    } else {
      await pool.query(
        `INSERT INTO fornecedor_solicitacoes (name, phone, contact_id, sales_channels, carrinho) VALUES ($1, $2, $3, $4, $5)`,
        [name.trim(), phone, contact.id, channels, temCarrinho ? JSON.stringify(carrinho) : null]
      )
    }

    const firstName = name.trim().split(" ")[0]
    const texto = temCarrinho
      ? `Oi, ${firstName}! Recebemos seu cadastro e seu pedido 📋\n\n${resumoCarrinho(carrinho)}\n\nNossa equipe confere seu cadastro e, assim que aprovar, seu pedido entra na fila e a gente te chama aqui pra combinar pagamento e frete. 😊`
      : `Oi, ${firstName}! Recebemos seu cadastro 📋\n\nNossa equipe analisa e te avisa por aqui assim que aprovar. 😊`
    await sendAndSave(contact.id, contact.phone_jid || contact.jid, texto).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
