import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { fmtDateBR } from "@/lib/tz"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { notifyClient, method, notes, amount } = body as {
      notifyClient?: boolean; method?: string; notes?: string; amount?: number
    }

    const { rows } = await pool.query(`
      SELECT p.id, p.number, p.paid_at, p.preco_cobrado, p.amount_paid,
             p.due_date::text AS due_date, p.contact_id AS "contactId",
             c.jid AS jid, c.name AS "contactName"
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (rows[0].paid_at) return NextResponse.json({ success: true, skipped: true })

    const totalValue  = rows[0].preco_cobrado != null ? Number(rows[0].preco_cobrado) : null
    const alreadyPaid = Number(rows[0].amount_paid ?? 0)
    const remaining   = totalValue != null ? Math.round((totalValue - alreadyPaid) * 100) / 100 : null

    const received = amount != null ? Number(amount) : remaining
    if (received == null || !(received > 0)) {
      return NextResponse.json({ error: "Informe um valor válido" }, { status: 400 })
    }
    if (remaining != null && received > remaining + 0.01) {
      return NextResponse.json({ error: `Valor maior que o restante (R$ ${remaining.toFixed(2).replace(".", ",")})` }, { status: 400 })
    }

    const newAmountPaid = totalValue != null
      ? Math.min(totalValue, Math.round((alreadyPaid + received) * 100) / 100)
      : Math.round((alreadyPaid + received) * 100) / 100
    const isFull = totalValue != null ? newAmountPaid >= totalValue - 0.01 : true

    await pool.query(`
      UPDATE dtf_pedidos
      SET amount_paid = $2,
          paid_at     = CASE WHEN $3 THEN NOW() ELSE paid_at END,
          is_paid     = CASE WHEN $3 THEN true ELSE is_paid END
      WHERE id = $1
    `, [id, newAmountPaid, isFull])

    await pool.query(`
      INSERT INTO receivable_payments (kind, order_id, amount, method, notes)
      VALUES ('dtf', $1, $2, $3, $4)
    `, [id, received, method ?? null, notes?.trim() || null])

    if (notifyClient && rows[0].jid) {
      const nome = (rows[0].contactName as string)?.split(" ")[0] ?? ""
      const valorPago = `R$ ${received.toFixed(2).replace(".", ",")}`
      let msg: string
      if (isFull) {
        msg = `Pagamento de *${valorPago}* do pedido *${rows[0].number}* confirmado! Obrigado${nome ? `, ${nome}` : ""} 🙏`
      } else {
        const restante = totalValue != null ? Math.max(0, totalValue - newAmountPaid) : null
        const restanteTxt = restante != null ? `R$ ${restante.toFixed(2).replace(".", ",")}` : "o restante"
        const vencTxt = rows[0].due_date ? ` — vencimento em *${fmtDateBR(rows[0].due_date)}*` : ""
        msg = `Recebemos *${valorPago}* do pedido *${rows[0].number}*. Ainda falta *${restanteTxt}*${vencTxt}. Qualquer dúvida é só chamar!`
      }
      sendAndSave(rows[0].contactId as number, rows[0].jid, msg).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      isFull,
      remaining: totalValue != null ? Math.max(0, Math.round((totalValue - newAmountPaid) * 100) / 100) : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
