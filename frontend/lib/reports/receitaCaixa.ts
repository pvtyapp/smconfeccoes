import { pool } from "@/lib/db"

// Venda a prazo (PIV 13/11/2026) — regra única pra todo relatório que soma dinheiro:
//  - À vista (sem vencimento): conta no dia em que a venda foi feita, como sempre.
//  - A prazo (com vencimento): NÃO conta no dia da venda. Cada baixa (total ou
//    parcela, gravada em receivable_payments) soma no dia em que o dinheiro
//    entrou. O custo das peças acompanha o dinheiro: entra na mesma proporção
//    da baixa (pagou metade, entra metade do custo), senão o dia da venda
//    mostraria prejuízo e o dia do pagamento lucro de 100%.
//  - Peças e quantidade de pedidos continuam no dia da venda (é quando a
//    mercadoria saiu do estoque).
//
// Venda a prazo pelo PDV fica em "pronto" até ser quitada (ver payOrder), então
// "venda feita" = concluído OU PDV pronto com vencimento.

// Filtro SQL de "venda feita" pra orders (alias o). À vista e a prazo juntos.
export const VENDA_FEITA_SQL = `(o.status = 'concluido' OR (o.source = 'pdv' AND o.status = 'pronto' AND o.due_date IS NOT NULL))`

export type CanalCaixa = "pdv" | "site" | "whatsapp" | "dtf"

export type Recebimento = {
  kind: "produto" | "dtf"
  orderId: number
  number: string
  source: CanalCaixa
  contactName: string | null
  amount: number        // quanto entrou nessa baixa
  total: number         // valor total do pedido
  custo: number | null  // custo das peças proporcional à baixa (null = produto sem custo cadastrado)
  vendaData: string     // YYYY-MM-DD, dia em que a venda foi feita
  pagoEm: string        // ISO, quando a baixa foi dada
}

export type VendaPrazo = {
  kind: "produto" | "dtf"
  orderId: number
  number: string
  source: CanalCaixa
  contactName: string | null
  total: number
  pago: number          // quanto já foi pago até agora (qualquer dia)
  dueDate: string | null
  vendaData: string
  pecas: number
  metros: number
}

const num = (v: unknown) => (v == null ? 0 : Number(v))

// Custo/metro do DTF: mesma fonte do Financeiro (material_cost do produto "DTF ...").
export async function custoMetroDtf(): Promise<number | null> {
  const { rows } = await pool.query(`
    SELECT material_cost::float AS "materialCost" FROM products
    WHERE LOWER(name) LIKE 'dtf%' AND status = 'active' ORDER BY created_at ASC LIMIT 1
  `)
  return rows[0]?.materialCost != null ? Number(rows[0].materialCost) : null
}

// Baixas de venda a prazo dadas entre from e to (datas YYYY-MM-DD, fuso de SP).
// Só pedido COM vencimento: baixa de pedido à vista (ex.: DTF comum pago depois)
// já contou no dia da venda e não pode contar de novo.
export async function recebimentosPrazo(from: string, to: string, opts: { dtf?: boolean } = {}): Promise<Recebimento[]> {
  const incluirDtf = opts.dtf ?? true

  const { rows: prod } = await pool.query(`
    SELECT rp.order_id AS "orderId", o.number, o.source,
           COALESCE(c.nome_cadastro, c.name) AS "contactName",
           rp.amount::float AS amount, o.total_value::float AS total,
           rp.created_at AS "pagoEm",
           TO_CHAR(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS "vendaData",
           cu.custo, cu.conhecido
    FROM receivable_payments rp
    JOIN orders o ON o.id = rp.order_id
    LEFT JOIN wa_contacts c ON c.id = o.contact_id
    LEFT JOIN LATERAL (
      SELECT SUM(oi.qty * p.material_cost)::float AS custo,
             BOOL_OR(p.material_cost IS NOT NULL) AS conhecido
      FROM order_items oi
      LEFT JOIN LATERAL (
        SELECT material_cost FROM products
        WHERE TRIM(LOWER(name)) = TRIM(LOWER(oi.product_name))
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END LIMIT 1
      ) p ON true
      WHERE oi.order_id = o.id
    ) cu ON true
    WHERE rp.kind = 'produto'
      AND o.due_date IS NOT NULL
      AND o.status <> 'cancelado'
      AND o.source IN ('pdv', 'whatsapp', 'site')
      AND o.number NOT LIKE 'COB-%'
      AND DATE(rp.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    ORDER BY rp.created_at ASC
  `, [from, to])

  const out: Recebimento[] = prod.map(r => {
    const total = num(r.total)
    const frac = total > 0 ? num(r.amount) / total : 1
    return {
      kind: "produto", orderId: r.orderId, number: r.number, source: r.source,
      contactName: r.contactName, amount: num(r.amount), total,
      custo: r.conhecido ? num(r.custo) * frac : null,
      vendaData: r.vendaData, pagoEm: new Date(r.pagoEm).toISOString(),
    }
  })

  if (incluirDtf) {
    const { rows: dtf } = await pool.query(`
      SELECT rp.order_id AS "orderId", p.number,
             COALESCE(c.nome_cadastro, c.name, p.cliente) AS "contactName",
             rp.amount::float AS amount, p.preco_cobrado::float AS total,
             COALESCE(p.metros_finais, p.metros, 0)::float AS metros,
             rp.created_at AS "pagoEm", TO_CHAR(p.data, 'YYYY-MM-DD') AS "vendaData"
      FROM receivable_payments rp
      JOIN dtf_pedidos p ON p.id = rp.order_id
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE rp.kind = 'dtf'
        AND p.due_date IS NOT NULL
        AND p.status <> 'cancelado'
        AND DATE(rp.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
      ORDER BY rp.created_at ASC
    `, [from, to])
    const custoMetro = dtf.length ? await custoMetroDtf() : null
    for (const r of dtf) {
      const total = num(r.total)
      const frac = total > 0 ? num(r.amount) / total : 1
      out.push({
        kind: "dtf", orderId: r.orderId, number: r.number ?? `DTF-${r.orderId}`, source: "dtf",
        contactName: r.contactName, amount: num(r.amount), total,
        custo: custoMetro != null ? num(r.metros) * custoMetro * frac : null,
        vendaData: r.vendaData, pagoEm: new Date(r.pagoEm).toISOString(),
      })
    }
  }

  return out.sort((a, b) => a.pagoEm.localeCompare(b.pagoEm))
}

// Vendas a prazo FEITAS entre from e to (não somam no dinheiro do dia; aparecem à parte).
export async function vendasPrazo(from: string, to: string, opts: { dtf?: boolean } = {}): Promise<VendaPrazo[]> {
  const incluirDtf = opts.dtf ?? true

  const { rows: prod } = await pool.query(`
    SELECT o.id AS "orderId", o.number, o.source,
           COALESCE(c.nome_cadastro, c.name) AS "contactName",
           o.total_value::float AS total, COALESCE(o.amount_paid, 0)::float AS pago,
           o.due_date::text AS "dueDate",
           TO_CHAR(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS "vendaData",
           (SELECT COALESCE(SUM(oi.qty), 0)::int FROM order_items oi
             WHERE oi.order_id = o.id AND LOWER(oi.product_name) NOT LIKE 'dtf%') AS pecas,
           (SELECT COALESCE(SUM(oi.qty), 0)::float FROM order_items oi
             WHERE oi.order_id = o.id AND LOWER(oi.product_name) LIKE 'dtf%') AS metros
    FROM orders o
    LEFT JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.due_date IS NOT NULL
      AND ${VENDA_FEITA_SQL}
      AND o.source IN ('pdv', 'whatsapp', 'site')
      AND o.number NOT LIKE 'COB-%'
      AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    ORDER BY o.created_at ASC
  `, [from, to])

  const out: VendaPrazo[] = prod.map(r => ({
    kind: "produto", orderId: r.orderId, number: r.number, source: r.source, contactName: r.contactName,
    total: num(r.total), pago: num(r.pago), dueDate: r.dueDate, vendaData: r.vendaData,
    pecas: num(r.pecas), metros: num(r.metros),
  }))

  if (incluirDtf) {
    const { rows: dtf } = await pool.query(`
      SELECT p.id AS "orderId", p.number,
             COALESCE(c.nome_cadastro, c.name, p.cliente) AS "contactName",
             p.preco_cobrado::float AS total, COALESCE(p.amount_paid, 0)::float AS pago,
             p.due_date::text AS "dueDate", TO_CHAR(p.data, 'YYYY-MM-DD') AS "vendaData",
             COALESCE(p.metros_finais, p.metros, 0)::float AS metros
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.status = 'concluido' AND p.due_date IS NOT NULL
        AND p.data BETWEEN $1 AND $2
      ORDER BY p.created_at ASC
    `, [from, to])
    for (const r of dtf) {
      out.push({
        kind: "dtf", orderId: r.orderId, number: r.number ?? `DTF-${r.orderId}`, source: "dtf", contactName: r.contactName,
        total: num(r.total), pago: num(r.pago), dueDate: r.dueDate, vendaData: r.vendaData,
        pecas: 0, metros: num(r.metros),
      })
    }
  }
  return out
}
