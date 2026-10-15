import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"
import { MKT_INICIO, diasEntre, lucroDe } from "@/lib/mktFechamento"

// Gráfico do Dashboard: faturamento por dia, venda direta × marketplace. GET ?from&to
// Venda direta = o mesmo critério da Receita bruta do Relatório Financeiro: pedidos concluídos
// (pdv/whatsapp/site, sem COB-) pela data do pedido + DTF concluído pela data + avarias vendidas.
// Marketplace = marketplace_fechamentos (null no dia sem nenhum lançamento).

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const from = p.get("from") ?? ""
  const to = p.get("to") ?? ""
  if (!DIA_RE.test(from) || !DIA_RE.test(to) || from > to) return NextResponse.json({ error: "from e to são obrigatórios (YYYY-MM-DD)" }, { status: 400 })
  try {
    const [ordens, dtf, avarias, mkt] = await Promise.all([
      pool.query(`
        SELECT to_char(DATE(created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS dia, SUM(total_value)::float AS v
        FROM orders
        WHERE status = 'concluido' AND source IN ('pdv', 'whatsapp', 'site') AND number NOT LIKE 'COB-%'
          AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
        GROUP BY 1`, [from, to]),
      pool.query(`
        SELECT to_char(data, 'YYYY-MM-DD') AS dia, SUM(preco_cobrado)::float AS v
        FROM dtf_pedidos WHERE status = 'concluido' AND data BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      pool.query(`
        SELECT to_char(DATE(resolved_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS dia, SUM(sale_price)::float AS v
        FROM defect_stock
        WHERE disposition = 'vendido' AND sale_price IS NOT NULL AND resolved_at IS NOT NULL
          AND DATE(resolved_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
        GROUP BY 1`, [from, to]),
      pool.query(`
        SELECT to_char(dia, 'YYYY-MM-DD') AS dia, loja, pedidos, vendas::float AS vendas, taxas::float AS taxas,
          cupom::float AS cupom, frete::float AS frete, ads::float AS ads, custo::float AS custo
        FROM marketplace_fechamentos WHERE dia BETWEEN $1 AND $2`, [from, to]),
    ])

    const direta = new Map<string, number>()
    for (const r of [...ordens.rows, ...dtf.rows, ...avarias.rows]) direta.set(r.dia, (direta.get(r.dia) ?? 0) + Number(r.v ?? 0))
    const mktDia = new Map<string, { vendas: number; lojas: number }>()
    let mktVendas = 0, mktLucro = 0, mktPedidos = 0
    for (const f of mkt.rows) {
      const d = mktDia.get(f.dia) ?? { vendas: 0, lojas: 0 }
      d.vendas += f.vendas; d.lojas++; mktDia.set(f.dia, d)
      mktVendas += f.vendas; mktPedidos += f.pedidos; mktLucro += lucroDe(f)
    }

    const hoje = todayBR()
    const daily = diasEntre(from, to).map(d => ({
      date: d,
      direta: direta.get(d) ?? 0,
      marketplace: mktDia.has(d) ? mktDia.get(d)!.vendas : null,
    }))
    return NextResponse.json({
      daily,
      marketplace: {
        vendas: mktVendas, lucro: mktLucro, pedidos: mktPedidos,
        // dia sem as 3 lojas lançadas (de 01/10 em diante; hoje entra amanhã)
        diasIncompletos: daily.filter(d => d.date >= MKT_INICIO && d.date <= hoje && (mktDia.get(d.date)?.lojas ?? 0) < 3).map(d => d.date),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
