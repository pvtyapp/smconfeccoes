import { pool } from "@/lib/db"

export type FechamentoExpense = { category: string; description: string; amount: number } | null

function fmtMoney(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`
}

function fmtDateBRFromISO(date: string): string {
  const [y, m, d] = date.split("-")
  return `${d}/${m}/${y}`
}

type ChannelRow = { number: string; totalValue: number; contactName: string | null }

async function ordersForChannel(source: string, date: string): Promise<ChannelRow[]> {
  const { rows } = await pool.query(`
    SELECT o.number, o.total_value::float AS "totalValue", COALESCE(c.nome_cadastro, c.name) AS "contactName"
    FROM orders o
    JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.status = 'concluido' AND o.source = $1 AND o.number NOT LIKE 'COB-%'
      AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') = $2
    ORDER BY o.created_at ASC
  `, [source, date])
  return rows as ChannelRow[]
}

async function dtfOrdersToday(date: string): Promise<ChannelRow[]> {
  const { rows } = await pool.query(`
    SELECT p.number, p.preco_cobrado::float AS "totalValue", COALESCE(c.nome_cadastro, c.name, p.cliente) AS "contactName"
    FROM dtf_pedidos p
    LEFT JOIN wa_contacts c ON c.id = p.contact_id
    WHERE p.status = 'concluido' AND p.data = $1
    ORDER BY p.created_at ASC
  `, [date])
  return rows as ChannelRow[]
}

function buildChannelBlock(label: string, rows: ChannelRow[]): string {
  const total = rows.reduce((s, r) => s + Number(r.totalValue), 0)
  if (rows.length === 0) {
    return `${label}\n\nNenhuma venda hoje.`
  }
  const lines = rows.map((r, i) => `${i + 1}. ${r.contactName ?? "?"} — ${r.number} — ${fmtMoney(Number(r.totalValue))}`)
  return `${label}\nTotal: *${fmtMoney(total)}* (${rows.length} ${rows.length === 1 ? "venda" : "vendas"})\n\n${lines.join("\n")}`
}

// Custo de insumo (material_cost cadastrado no produto) dos itens vendidos hoje —
// mesma fonte usada no Financeiro geral (/api/relatorio-financeiro), nunca
// average_cost da variante (pode carregar custo de costura injetado por outro
// fluxo). Decidido com o PIV em 2026-08-31.
async function custoInsumosHoje(date: string): Promise<{ total: number; known: boolean }> {
  const { rows } = await pool.query(`
    SELECT oi.qty::float AS qty, p.material_cost::float AS "materialCost"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN LATERAL (
      SELECT material_cost FROM products
      WHERE TRIM(LOWER(name)) = TRIM(LOWER(oi.product_name))
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END LIMIT 1
    ) p ON true
    WHERE o.status = 'concluido' AND o.number NOT LIKE 'COB-%'
      AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') = $1
  `, [date])
  let total = 0
  let known = false
  for (const r of rows) {
    if (r.materialCost != null) { total += Number(r.qty) * Number(r.materialCost); known = true }
  }

  const { rows: dtfRows } = await pool.query(`
    SELECT COALESCE(SUM(COALESCE(metros_finais, metros, 0)), 0)::float AS metros
    FROM dtf_pedidos WHERE status = 'concluido' AND data = $1
  `, [date])
  const metros = Number(dtfRows[0]?.metros ?? 0)
  if (metros > 0) {
    const { rows: dtfProdutoRows } = await pool.query(`
      SELECT material_cost::float AS "materialCost" FROM products
      WHERE LOWER(name) LIKE 'dtf%' AND status = 'active' ORDER BY created_at ASC LIMIT 1
    `)
    const custoUnit = dtfProdutoRows[0]?.materialCost ?? null
    if (custoUnit != null) { total += metros * Number(custoUnit); known = true }
  }
  return { total, known }
}

// Custo fixo (aluguel/energia/etc, exceto "Custo de Costura") rateado por 1 dia
// (mesmo pro-rateio do Financeiro geral, só que fração = 1/30 em vez de dias/30).
async function custoFixoHoje(): Promise<number> {
  const { rows } = await pool.query(`
    SELECT category, monthly_value::float AS "monthlyValue" FROM operational_costs WHERE active = true
  `)
  return rows
    .filter(r => r.category !== "Custo de Costura")
    .reduce((s, r) => s + Number(r.monthlyValue) / 30, 0)
}

async function variableCostsToday(date: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS total FROM variable_costs WHERE cost_date = $1`,
    [date]
  )
  return Number(rows[0]?.total ?? 0)
}

// Fechamento resumido do dia pro grupo Financeiro — versão enxuta do DRE geral
// (/api/relatorio-financeiro): só o que interessa pro resumo diário (receita por
// canal + margem). Não replica avarias/marketplace/custo de costura — fora do
// escopo pedido pro fechamento diário no WhatsApp.
//
// Retorna um array de mensagens — uma por bloco (DTF/Balcão/Site/WhatsApp) mais
// o resumo final — pra cada uma virar uma mensagem separada no grupo.
export async function buildFechamentoBlocks(date: string, expense: FechamentoExpense): Promise<string[]> {
  const [pdvRows, siteRows, whatsappRows, dtfRows] = await Promise.all([
    ordersForChannel("pdv", date),
    ordersForChannel("site", date),
    ordersForChannel("whatsapp", date),
    dtfOrdersToday(date),
  ])

  const blocks: string[] = [
    buildChannelBlock("🧵 *DTF*", dtfRows),
    buildChannelBlock("🏬 *Balcão*", pdvRows),
    buildChannelBlock("🌐 *Site*", siteRows),
    buildChannelBlock("💬 *WhatsApp*", whatsappRows),
  ]

  const receitaTotal = [...pdvRows, ...siteRows, ...whatsappRows, ...dtfRows]
    .reduce((s, r) => s + Number(r.totalValue), 0)

  const [{ total: custoInsumos, known: custoConhecido }, custoFixo, despesaVariavel] = await Promise.all([
    custoInsumosHoje(date),
    custoFixoHoje(),
    variableCostsToday(date),
  ])

  const lucroBruto  = custoConhecido ? receitaTotal - custoInsumos : null
  const resultadoOp = lucroBruto !== null ? lucroBruto - custoFixo - despesaVariavel : null
  const margemBruta = lucroBruto !== null && receitaTotal > 0 ? (lucroBruto / receitaTotal) * 100 : null
  const margemOp    = resultadoOp !== null && receitaTotal > 0 ? (resultadoOp / receitaTotal) * 100 : null

  const despesaLinha = expense
    ? `Despesa variável: ${expense.category} — ${expense.description}: ${fmtMoney(expense.amount)}`
    : "Despesa variável: nenhuma lançada hoje."

  const resumo = [
    `📊 *Fechamento do dia — ${fmtDateBRFromISO(date)}*`,
    "",
    `Total do dia: *${fmtMoney(receitaTotal)}*`,
    despesaLinha,
    custoConhecido ? `Custo de insumos: -${fmtMoney(custoInsumos)}` : "Custo de insumos: incompleto (produto sem custo cadastrado)",
    lucroBruto !== null ? `Lucro bruto: *${fmtMoney(lucroBruto)}*${margemBruta !== null ? ` (${margemBruta.toFixed(1)}%)` : ""}` : null,
    resultadoOp !== null ? `Resultado operacional: *${fmtMoney(resultadoOp)}*${margemOp !== null ? ` (${margemOp.toFixed(1)}%)` : ""}` : null,
  ].filter((l): l is string => l !== null).join("\n")

  blocks.push(resumo)
  return blocks
}
