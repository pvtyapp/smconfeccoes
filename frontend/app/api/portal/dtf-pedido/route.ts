import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { criarPedidoDtfSite } from "@/lib/portal/pedidoSite"
import { precoMetroDtf } from "@/lib/dtfPreco"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Metros de DTF pedidos pelo site novo (PIV 05/11): cai na triagem do DTF e a
// equipe pede a arte no WhatsApp. Valor final quem fecha é o painel, ao concluir.
export async function POST(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Entra com seu WhatsApp pra mandar o pedido" }, { status: 401 })
  try {
    const { metros } = await req.json() as { metros: number }
    const m = Math.floor(Number(metros) || 0)
    if (m < 1 || m > 500) return NextResponse.json({ error: "Quantidade de metros inválida" }, { status: 400 })

    const number = await criarPedidoDtfSite(pool, session.contactId, m)

    try {
      const { rows } = await pool.query(`SELECT jid, phone_jid FROM wa_contacts WHERE id = $1`, [session.contactId])
      const c = rows[0]
      const preco = await precoMetroDtf()
      const valor = preco ? `\n💰 ${m} m × ${fmtR(preco.precoMetro)} = *${fmtR(preco.precoMetro * m)}*` : ""
      if (c?.jid) {
        await sendAndSave(session.contactId, c.phone_jid || c.jid,
          `✅ Pedido de DTF *${number}* recebido!\n\n${m} m de DTF Têxtil 60 cm.${valor}\n\nAgora é só mandar a arte aqui nessa conversa. 😊`
        ).catch(() => {})
      }
    } catch (notifyErr) {
      console.error("[dtf-pedido] pedido criado, mas aviso pelo WhatsApp falhou:", notifyErr)
    }

    return NextResponse.json({ ok: true, number })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
