import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { normalizePhone } from "@/lib/portal/phone"
import { consumeOtp } from "@/lib/portal/otp"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, code, salesChannels } =
      await req.json() as { name: string; phone: string; code: string; salesChannels?: string[] }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    const verified = await consumeOtp(phone, code ?? "", "signup")
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const channels = Array.isArray(salesChannels) ? salesChannels.filter((c) => typeof c === "string" && c.trim()) : []

    // WhatsApp confirmado — cria/atualiza o contato já com nome_cadastro
    // (senão a solicitação ficaria só como texto solto em fornecedor_solicitacoes,
    // sem contato pra mandar a confirmação abaixo nem pra puxar depois na aprovação).
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
        `INSERT INTO fornecedor_solicitacoes (name, phone, sales_channels, contact_id)
         VALUES ($1, $2, $3, $4)`,
        [name.trim(), phone, channels.length ? channels : null, contact.id]
      )
    }

    const firstName = name.trim().split(" ")[0]
    await sendAndSave(
      contact.id, contact.phone_jid || contact.jid,
      `Oi, ${firstName}! Recebemos sua solicitação de acesso 📋\n\nJá confirmamos seu WhatsApp — agora é só aguardar, nossa equipe analisa e te avisa por aqui assim que aprovar. 😊`
    ).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
