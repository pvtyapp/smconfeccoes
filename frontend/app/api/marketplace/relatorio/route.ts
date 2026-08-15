import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/marketplace/relatorio?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Custo do dia = peças separadas (não canceladas) naquele dia × material_cost
// de cada produto — mesma fonte de custo do Relatório Financeiro principal.
// Receita do dia = o que foi digitado em marketplace_daily_revenue (selo
// "real"), ou custo × (1 + markup%) se ninguém digitou (selo "estimado").
// Fica de fora do DRE principal (app/api/relatorio-financeiro) de propósito —
// marketplace não é canal de venda direta, é reposição de estoque de
// pedidos que já venderam lá fora.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")
    if (!from || !to) {
      return NextResponse.json({ error: "from e to são obrigatórios" }, { status: 400 })
    }

    const [{ rows: configRows }, { rows: dayRows }, { rows: revenueRows }] = await Promise.all([
      pool.query(`SELECT markup_percent AS "markupPercent" FROM marketplace_config WHERE id = 1`),
      pool.query(`
        SELECT
          TO_CHAR(DATE(ms.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS date,
          SUM(msi.qty)::int AS pecas,
          SUM(msi.qty * COALESCE(p.material_cost, 0))::float AS custo,
          COUNT(DISTINCT ms.id)::int AS separacoes,
          BOOL_OR(p.material_cost IS NULL) AS "custoIncompleto"
        FROM marketplace_separations ms
        JOIN marketplace_separation_items msi ON msi.separation_id = ms.id
        JOIN product_variants pv ON pv.id = msi.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE ms.canceled_at IS NULL
          AND DATE(ms.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
        GROUP BY 1
        ORDER BY 1 DESC
      `, [from, to]),
      pool.query(`
        SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, receita_real AS "receitaReal"
        FROM marketplace_daily_revenue
        WHERE date BETWEEN $1 AND $2
      `, [from, to]),
    ])

    const markupPercent = Number(configRows[0]?.markupPercent ?? 50)
    const revenueByDate = new Map<string, number>()
    for (const r of revenueRows) {
      if (r.receitaReal != null) revenueByDate.set(r.date, Number(r.receitaReal))
    }

    const days = dayRows.map(d => {
      const custo         = Number(d.custo)
      const receitaReal   = revenueByDate.get(d.date) ?? null
      const receitaEstim  = custo * (1 + markupPercent / 100)
      const receita       = receitaReal ?? receitaEstim
      const isReal        = receitaReal !== null
      const lucro         = receita - custo
      const margem        = receita > 0 ? (lucro / receita) * 100 : null
      return {
        date: d.date,
        pecas: d.pecas,
        separacoes: d.separacoes,
        custo,
        custoIncompleto: d.custoIncompleto,
        receita,
        isReal,
        lucro,
        margem,
      }
    })

    const totalPecas = days.reduce((s, d) => s + d.pecas, 0)
    const totalCusto = days.reduce((s, d) => s + d.custo, 0)
    const totalReceita = days.reduce((s, d) => s + d.receita, 0)
    const totalLucro = totalReceita - totalCusto

    return NextResponse.json({
      period: { from, to },
      markupPercent,
      days,
      summary: {
        totalPecas,
        totalCusto,
        totalReceita,
        totalLucro,
        margem: totalReceita > 0 ? (totalLucro / totalReceita) * 100 : null,
        diasComCustoIncompleto: days.filter(d => d.custoIncompleto).length,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
