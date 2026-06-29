import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/relatorio-financeiro?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    if (!from || !to) {
      return NextResponse.json({ error: "from e to são obrigatórios" }, { status: 400 })
    }

    const days = Math.max(1, Math.ceil(
      (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    ) + 1)

    // 1. Orders no período (status != cancelado, source pdv/whatsapp/manual, sem COB-)
    const { rows: orders } = await pool.query(`
      SELECT
        o.id, o.number, o.source, o.status,
        o.total_value AS "totalValue",
        json_agg(
          json_build_object(
            'productName', oi.product_name,
            'qty',         oi.qty,
            'unitPrice',   oi.unit_price,
            'costPrice',   p.material_cost
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT material_cost FROM products
        WHERE LOWER(name) = LOWER(oi.product_name) AND status = 'active'
        LIMIT 1
      ) p ON true
      WHERE o.status != 'cancelado'
        AND o.source IN ('pdv', 'whatsapp', 'manual')
        AND o.number NOT LIKE 'COB-%'
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
      GROUP BY o.id
      ORDER BY o.id DESC
    `, [from, to])

    // 2. Custos operacionais ativos
    const { rows: opCosts } = await pool.query(`
      SELECT name, category, monthly_value AS "monthlyValue"
      FROM operational_costs
      WHERE active = true
    `)

    // 3. Custos variáveis no período
    const { rows: varCosts } = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::float AS total
      FROM variable_costs
      WHERE cost_date BETWEEN $1 AND $2
    `, [from, to])

    // 4. Entradas de matéria-prima compradas no período
    const { rows: matEntradas } = await pool.query(`
      SELECT
        COALESCE(SUM(total_qty * unit_price), 0)::float AS total,
        COUNT(*)::int AS count
      FROM raw_material_entries
      WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    `, [from, to])

    // 5. Bobinas esgotadas no período (consumo de insumos em produção)
    const { rows: matSaidas } = await pool.query(`
      SELECT
        COALESCE(SUM(total_qty * unit_price), 0)::float AS total,
        COUNT(*)::int AS count
      FROM raw_material_entries
      WHERE status = 'esgotada'
        AND exhausted_at IS NOT NULL
        AND DATE(exhausted_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    `, [from, to])

    // ── Calcular DRE ──────────────────────────────────────────────────────────
    const concluded = orders.filter(o => o.status === "concluido")

    // Receita bruta — apenas pedidos concluídos
    const receitaBruta = concluded.reduce((s: number, o: { totalValue: string | null }) => s + Number(o.totalValue ?? 0), 0)

    // Custo de insumos (material_cost × qty) — só para pedidos concluídos
    let custoInsumos      = 0
    let custoInsumosKnown = false
    const byProduct: Map<string, { revenue: number; cost: number; qty: number; hasCost: boolean }> = new Map()

    for (const o of concluded) {
      for (const item of (o.items ?? [])) {
        const lineRevenue = (item.unitPrice ?? 0) * item.qty
        const cur = byProduct.get(item.productName) ?? { revenue: 0, cost: 0, qty: 0, hasCost: false }
        cur.revenue += lineRevenue
        cur.qty     += item.qty
        if (item.costPrice != null) {
          const lineCost = item.costPrice * item.qty
          custoInsumos += lineCost
          custoInsumosKnown = true
          cur.cost    += lineCost
          cur.hasCost  = true
        }
        byProduct.set(item.productName, cur)
      }
    }

    // Custo operacional pro-rateado pelo período
    const fraction = days / 30
    let custoCostura = 0
    let custoFixo    = 0
    for (const c of opCosts) {
      const val = Number(c.monthlyValue) * fraction
      if (c.category === "Custo de Costura") custoCostura += val
      else custoFixo += val
    }

    const custoVariavel = Number(varCosts[0]?.total ?? 0)
    const lucroBruto    = custoInsumosKnown ? receitaBruta - custoInsumos : null
    const resultadoOp   = lucroBruto !== null
      ? lucroBruto - custoCostura - custoFixo - custoVariavel
      : null

    const totalPecas  = concluded.reduce((s: number, o: { items: Array<{ qty: number }> | null }) =>
      s + (o.items ?? []).reduce((si: number, i: { qty: number }) => si + i.qty, 0), 0)
    const ticketMedio = concluded.length > 0 ? receitaBruta / concluded.length : 0

    // Revenue by channel
    const byChannel: Record<string, number> = {}
    for (const o of concluded) {
      byChannel[o.source] = (byChannel[o.source] ?? 0) + Number(o.totalValue ?? 0)
    }

    // Product ranking
    const productRanking = Array.from(byProduct.entries())
      .map(([name, d]) => ({
        name,
        revenue: d.revenue,
        cost:    d.hasCost ? d.cost : null,
        margin:  d.hasCost && d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : null,
        qty:     d.qty,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json({
      period: { from, to, days },
      dre: {
        receitaBruta,
        custoInsumos:  custoInsumosKnown ? custoInsumos : null,
        lucroBruto,
        custoCostura,
        custoFixo,
        custoVariavel,
        resultadoOp,
      },
      summary: {
        pedidosTotal:      orders.length,
        pedidosConcluidos: concluded.length,
        totalPecas,
        ticketMedio,
        margemBruta: lucroBruto !== null && receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : null,
        margemOp:    resultadoOp !== null && receitaBruta > 0 ? (resultadoOp / receitaBruta) * 100 : null,
      },
      byChannel,
      productRanking,
      materialFlow: {
        entradas: { total: Number(matEntradas[0]?.total ?? 0), count: Number(matEntradas[0]?.count ?? 0) },
        saidas:   { total: Number(matSaidas[0]?.total  ?? 0), count: Number(matSaidas[0]?.count  ?? 0) },
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
