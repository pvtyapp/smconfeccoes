import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"
import { findContactByPhone } from "@/lib/portal/phone"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

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

    await sendAndSave(
      contact!.id, contact!.jid,
      `Oi, ${solicitacao.name.split(" ")[0]}! Seu acesso pra comprar com a *SM Confecções* foi liberado 🎉\n\nJá pode fazer seu pedido pelo site: https://smconfeccoes.com.br/catalogo`
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
