import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { fmtDateOnlyBR } from "@/lib/tz"

export type PayReceivableResult = {
  skipped?: boolean
  isFull: boolean
  received: number
  remaining: number | null
  number: string
  dueDate: string | null
}

type PayOpts = {
  method?: string
  notes?: string
  notifyClient?: boolean
  actor?: string
}

function buildNote(isFull: boolean, received: number, opts: PayOpts): string {
  return [
    isFull ? "Pagamento confirmado" : "Pagamento parcial confirmado",
    `Valor: R$ ${received.toFixed(2).replace(".", ",")}`,
    opts.method ? `Forma: ${opts.method}` : null,
    opts.notes?.trim() || null,
  ].filter(Boolean).join(" · ")
}

function notifyMsg(kind: "produto" | "dtf", number: string, received: number, isFull: boolean, remaining: number | null, dueDate: string | null, contactName: string | null): string {
  const nome = contactName?.split(" ")[0] ?? ""
  const valorPago = `R$ ${received.toFixed(2).replace(".", ",")}`
  if (isFull) {
    return `Pagamento de *${valorPago}* do pedido *${number}* confirmado! Obrigado${nome ? `, ${nome}` : ""} 🙏`
  }
  const restanteTxt = remaining != null ? `R$ ${remaining.toFixed(2).replace(".", ",")}` : "o restante"
  const vencTxt = dueDate ? ` — vencimento em *${fmtDateOnlyBR(dueDate)}*` : ""
  return `Recebemos *${valorPago}* do pedido *${number}*. Ainda falta *${restanteTxt}*${vencTxt}. Qualquer dúvida é só chamar!`
}

// Dá baixa (total ou parcial) num pedido de produto — usado tanto pela tela de
// Clientes a Receber quanto pelo bot administrativo do WhatsApp, pra garantir
// que os dois caminhos façam exatamente a mesma coisa (mesmo cálculo de
// restante, mesmo evento na timeline, mesmo lançamento em receivable_payments).
export async function payOrder(id: number, amount: number | undefined, opts: PayOpts = {}): Promise<PayReceivableResult> {
  const { rows } = await pool.query(`
    SELECT o.id, o.number, o.status, o.source, o.paid_at, o.total_value, o.amount_paid,
           o.due_date::text AS due_date, o.contact_id AS "contactId",
           c.jid AS jid, c.name AS "contactName"
    FROM orders o
    LEFT JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.id = $1
  `, [id])
  if (!rows[0]) throw new Error("Pedido não encontrado")
  if (rows[0].paid_at) return { skipped: true, isFull: true, received: 0, remaining: 0, number: rows[0].number, dueDate: rows[0].due_date }

  const totalValue  = rows[0].total_value != null ? Number(rows[0].total_value) : null
  const alreadyPaid = Number(rows[0].amount_paid ?? 0)
  const remaining   = totalValue != null ? Math.round((totalValue - alreadyPaid) * 100) / 100 : null

  const received = amount != null ? Number(amount) : remaining
  if (received == null || !(received > 0)) throw new Error("Informe um valor válido")
  if (remaining != null && received > remaining + 0.01) {
    throw new Error(`Valor maior que o restante (R$ ${remaining.toFixed(2).replace(".", ",")})`)
  }

  const newAmountPaid = totalValue != null
    ? Math.min(totalValue, Math.round((alreadyPaid + received) * 100) / 100)
    : Math.round((alreadyPaid + received) * 100) / 100
  const isFull = totalValue != null ? newAmountPaid >= totalValue - 0.01 : true

  // Venda PDV: mercadoria já saiu no ato da venda, "pronto" a prazo só
  // significa "aguardando pagamento" — sem etapa de entrega separada, ao
  // contrário do pedido de produção normal (onde "concluido" = entregue de
  // verdade). Quitar o prazo de uma venda PDV fecha o ciclo igual à vista já
  // fecha na criação (ver finalStatus em /api/pdv). Nunca promove pedido de
  // produção: lá "concluido" é um evento de entrega distinto de "pago".
  const closesPdvCycle = isFull && rows[0].source === "pdv" && rows[0].status === "pronto"

  await pool.query(`
    UPDATE orders
    SET amount_paid   = $2,
        paid_at       = CASE WHEN $3 THEN NOW() ELSE paid_at END,
        pix_confirmed = CASE WHEN $3 THEN true ELSE pix_confirmed END,
        status        = CASE WHEN $4 THEN 'concluido' ELSE status END,
        completed_at  = CASE WHEN $4 THEN NOW() ELSE completed_at END
    WHERE id = $1
  `, [id, newAmountPaid, isFull, closesPdvCycle])

  await pool.query(`
    INSERT INTO order_events (order_id, status, actor, note)
    SELECT id, status, $2, $3 FROM orders WHERE id = $1
  `, [id, opts.actor ?? "dashboard", buildNote(isFull, received, opts)])

  await pool.query(`
    INSERT INTO receivable_payments (kind, order_id, amount, method, notes)
    VALUES ('produto', $1, $2, $3, $4)
  `, [id, received, opts.method ?? null, opts.notes?.trim() || null])

  const remainingAfter = totalValue != null ? Math.max(0, Math.round((totalValue - newAmountPaid) * 100) / 100) : null

  if (opts.notifyClient && rows[0].jid) {
    sendAndSave(rows[0].contactId as number, rows[0].jid, notifyMsg("produto", rows[0].number, received, isFull, remainingAfter, rows[0].due_date, rows[0].contactName)).catch(() => {})
  }

  return { isFull, received, remaining: remainingAfter, number: rows[0].number, dueDate: rows[0].due_date }
}

// Dá baixa num pedido DTF — mesmo princípio do payOrder, mas sem order_events
// (dtf_pedidos não tem timeline própria) nem promoção de status por pagamento.
export async function payDtfPedido(id: number, amount: number | undefined, opts: PayOpts = {}): Promise<PayReceivableResult> {
  const { rows } = await pool.query(`
    SELECT p.id, p.number, p.paid_at, p.preco_cobrado, p.amount_paid,
           p.due_date::text AS due_date, p.contact_id AS "contactId",
           c.jid AS jid, c.name AS "contactName"
    FROM dtf_pedidos p
    LEFT JOIN wa_contacts c ON c.id = p.contact_id
    WHERE p.id = $1
  `, [id])
  if (!rows[0]) throw new Error("Pedido não encontrado")
  if (rows[0].paid_at) return { skipped: true, isFull: true, received: 0, remaining: 0, number: rows[0].number, dueDate: rows[0].due_date }

  const totalValue  = rows[0].preco_cobrado != null ? Number(rows[0].preco_cobrado) : null
  const alreadyPaid = Number(rows[0].amount_paid ?? 0)
  const remaining   = totalValue != null ? Math.round((totalValue - alreadyPaid) * 100) / 100 : null

  const received = amount != null ? Number(amount) : remaining
  if (received == null || !(received > 0)) throw new Error("Informe um valor válido")
  if (remaining != null && received > remaining + 0.01) {
    throw new Error(`Valor maior que o restante (R$ ${remaining.toFixed(2).replace(".", ",")})`)
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
  `, [id, received, opts.method ?? null, opts.notes?.trim() || null])

  const remainingAfter = totalValue != null ? Math.max(0, Math.round((totalValue - newAmountPaid) * 100) / 100) : null

  if (opts.notifyClient && rows[0].jid) {
    sendAndSave(rows[0].contactId as number, rows[0].jid, notifyMsg("dtf", rows[0].number, received, isFull, remainingAfter, rows[0].due_date, rows[0].contactName)).catch(() => {})
  }

  return { isFull, received, remaining: remainingAfter, number: rows[0].number, dueDate: rows[0].due_date }
}
