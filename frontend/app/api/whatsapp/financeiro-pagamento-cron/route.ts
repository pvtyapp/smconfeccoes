import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendFinanceiro } from "@/lib/whatsapp/financeiroGroup"

const CHANNEL_LABELS: Record<string, string> = {
  pdv: "🏬 Balcão",
  site: "🌐 Site",
  whatsapp: "💬 WhatsApp",
}

function fmtMoney(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`
}

// Vercel Cron: */3 * * * * — avisa o grupo Financeiro a cada pagamento
// confirmado (pedido concluído/pago), pra alguém do time conferir. Poll em vez
// de hook nos 3 pontos que dão baixa em pagamento (payOrder/payDtfPedido, PDV
// à vista, conclusão via Kanban) — um lugar só pra manter, atraso de poucos
// minutos é aceitável pra esse aviso.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS financeiro_notified_at TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS financeiro_notified_at TIMESTAMPTZ`).catch(() => {})

  // Backfill único: sem isso, a primeira execução acharia TODO pedido já pago
  // na história inteira do sistema (financeiro_notified_at sempre NULL antes
  // da coluna existir) e disparia um flood de centenas de avisos retroativos
  // no grupo. Marca tudo que já é pagamento antigo como "já visto" sem
  // notificar — só pagamento a partir de agora gera aviso.
  const { rows: backfillDone } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'financeiro_pagamento_backfill_done'`
  ).catch(() => ({ rows: [] as { value: string }[] }))
  if (!backfillDone[0]) {
    await pool.query(`UPDATE orders SET financeiro_notified_at = NOW() WHERE paid_at IS NOT NULL AND financeiro_notified_at IS NULL`)
    await pool.query(`UPDATE dtf_pedidos SET financeiro_notified_at = NOW() WHERE paid_at IS NOT NULL AND financeiro_notified_at IS NULL`)
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('financeiro_pagamento_backfill_done', 'true') ON CONFLICT (key) DO NOTHING`
    )
    return NextResponse.json({ ok: true, backfilled: true, notified: 0 })
  }

  let notified = 0

  const { rows: orders } = await pool.query(`
    SELECT o.id, o.total_value::float AS "totalValue", o.source,
           COALESCE(c.nome_cadastro, c.name) AS "contactName"
    FROM orders o
    JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.paid_at IS NOT NULL AND o.financeiro_notified_at IS NULL
    ORDER BY o.paid_at ASC LIMIT 20
  `)
  for (const o of orders) {
    const label = CHANNEL_LABELS[o.source as string] ?? o.source
    await sendFinanceiro(`💰 Pagamento recebido de *${o.contactName ?? "?"}*, ${fmtMoney(Number(o.totalValue ?? 0))} (${label}). Confirmar!!!`)
    await pool.query(`UPDATE orders SET financeiro_notified_at = NOW() WHERE id = $1`, [o.id])
    notified++
  }

  const { rows: dtfRows } = await pool.query(`
    SELECT p.id, p.preco_cobrado::float AS "totalValue",
           COALESCE(c.nome_cadastro, c.name, p.cliente) AS "contactName"
    FROM dtf_pedidos p
    LEFT JOIN wa_contacts c ON c.id = p.contact_id
    WHERE p.paid_at IS NOT NULL AND p.financeiro_notified_at IS NULL
    ORDER BY p.paid_at ASC LIMIT 20
  `)
  for (const p of dtfRows) {
    await sendFinanceiro(`💰 Pagamento recebido de *${p.contactName ?? "?"}*, ${fmtMoney(Number(p.totalValue ?? 0))} (🧵 DTF). Confirmar!!!`)
    await pool.query(`UPDATE dtf_pedidos SET financeiro_notified_at = NOW() WHERE id = $1`, [p.id])
    notified++
  }

  return NextResponse.json({ ok: true, notified })
}
