import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"
import { MKT_INICIO, diasEntre, lucroDe, plataformaDaLoja } from "@/lib/mktFechamento"

// Painel do marketplace (estilo Metrizap, igual à aba da Vision): GET ?from&to&loja=<LOJA|todas>
// Totais e gráfico vêm de marketplace_fechamentos; curva ABC e lista de vendas, dos itens.
// Lucro = vendas − taxas − cupom − frete − ads − custo. Lucro por item é antes do Ads.

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/
const CAMPOS = ["pedidos", "pecas", "vendas", "taxas", "cupom", "frete", "ads", "custo", "lucro"] as const
type Tot = Record<typeof CAMPOS[number], number>
const zero = (): Tot => ({ pedidos: 0, pecas: 0, vendas: 0, taxas: 0, cupom: 0, frete: 0, ads: 0, custo: 0, lucro: 0 })

function voltar(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const from = p.get("from") ?? ""
  const to = p.get("to") ?? ""
  if (!DIA_RE.test(from) || !DIA_RE.test(to) || from > to) return NextResponse.json({ error: "from e to são obrigatórios (YYYY-MM-DD)" }, { status: 400 })
  const lojaParam = p.get("loja")?.trim().toUpperCase()
  const loja = lojaParam && lojaParam !== "TODAS" ? lojaParam : null
  const dias = diasEntre(from, to)
  const prevTo = voltar(from, 1)
  const prevFrom = voltar(from, dias.length)

  try {
    const fech = (de: string, ate: string) => pool.query(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, loja, pedidos, pecas, vendas::float AS vendas, taxas::float AS taxas,
         cupom::float AS cupom, frete::float AS frete, ads::float AS ads, custo::float AS custo, itens_sem_custo AS "semCusto",
         pedidos_upseller AS "pedidosUpseller"
       FROM marketplace_fechamentos WHERE dia BETWEEN $1 AND $2 AND ($3::text IS NULL OR loja = $3)`,
      [de, ate, loja]).then(r => r.rows)
    const [atual, anterior, itens, lojasRes] = await Promise.all([
      fech(from, to),
      fech(prevFrom, prevTo),
      pool.query(
        `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, loja, pedido, sku,
           COALESCE(titulo, (SELECT i2.titulo FROM marketplace_vendas_itens i2 WHERE i2.sku = i.sku AND i2.titulo IS NOT NULL LIMIT 1), sku) AS titulo,
           variacao, qtd, valor::float AS valor, taxa::float AS taxa, cupom::float AS cupom, frete::float AS frete, custo::float AS custo
         FROM marketplace_vendas_itens i
         WHERE dia BETWEEN $1 AND $2 AND ($3::text IS NULL OR loja = $3)
         ORDER BY dia DESC, loja, pedido`, [from, to, loja]).then(r => r.rows),
      pool.query(`SELECT DISTINCT loja FROM marketplace_fechamentos ORDER BY loja`).then(r => r.rows.map(x => x.loja as string)),
    ])

    const somar = (alvo: Tot, f: Record<string, number | null>) => {
      const l = lucroDe({ vendas: f.vendas ?? 0, taxas: f.taxas ?? 0, cupom: f.cupom ?? 0, frete: f.frete ?? 0, ads: f.ads ?? 0, custo: f.custo })
      for (const c of CAMPOS) alvo[c] += c === "lucro" ? l : Number(f[c] ?? 0)
    }
    const tot = zero(), totPrev = zero()
    const porDia = new Map<string, Tot>()
    const porLoja = new Map<string, Tot & { loja: string; plataforma: string; dias: number }>()
    let incompletos = 0, divergencias = 0
    for (const f of atual) {
      somar(tot, f)
      const d = porDia.get(f.dia) ?? zero(); somar(d, f); porDia.set(f.dia, d)
      const k = porLoja.get(f.loja) ?? { ...zero(), loja: f.loja, plataforma: plataformaDaLoja(f.loja), dias: 0 }
      somar(k, f); k.dias++; porLoja.set(f.loja, k)
      if (f.custo === null || f.semCusto > 0) incompletos++
      if (f.pedidosUpseller !== null && f.pedidosUpseller !== f.pedidos) divergencias++
    }
    for (const f of anterior) somar(totPrev, f)
    const variacao = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null)

    const daily = dias.map(d => {
      const x = porDia.get(d)
      return x ? { date: d, vendas: x.vendas, lucro: x.lucro, pedidos: x.pedidos } : { date: d, vendas: null, lucro: null, pedidos: null }
    })

    // dia + loja sem lançamento (a partir de 01/10; hoje nunca, o dia fecha amanhã)
    const hoje = todayBR()
    const lojasEsperadas = loja ? [loja] : ["SHP_MARI", "SHP_SAMU", "TKTK_SAMU"]
    const lancados = new Set(atual.map(f => `${f.dia}|${f.loja}`))
    const faltando: { dia: string; loja: string }[] = []
    for (const d of dias) {
      if (d < MKT_INICIO || d >= hoje) continue
      for (const l of lojasEsperadas) if (!lancados.has(`${d}|${l}`)) faltando.push({ dia: d, loja: l })
    }

    // Curva ABC por produto (título), pelo faturamento: A até 80% acumulado, B até 95%, C o resto
    const prodMap = new Map<string, { titulo: string; qtd: number; vendas: number; lucro: number; semCusto: number; lojas: Set<string> }>()
    for (const i of itens) {
      const k = i.titulo || "(sem título)"
      const pr = prodMap.get(k) ?? { titulo: k, qtd: 0, vendas: 0, lucro: 0, semCusto: 0, lojas: new Set<string>() }
      pr.qtd += i.qtd; pr.vendas += i.valor
      if (i.custo === null) pr.semCusto++
      else pr.lucro += i.valor - i.taxa - i.cupom - i.frete - i.custo
      pr.lojas.add(i.loja); prodMap.set(k, pr)
    }
    const totalItens = [...prodMap.values()].reduce((s, x) => s + x.vendas, 0)
    let acum = 0
    const produtos = [...prodMap.values()].sort((a, b) => b.vendas - a.vendas).map(x => {
      acum += x.vendas
      const pctAcum = totalItens ? (acum / totalItens) * 100 : 0
      return {
        titulo: x.titulo, qtd: x.qtd, vendas: x.vendas, lucro: x.lucro, semCusto: x.semCusto, lojas: [...x.lojas],
        pct: totalItens ? (x.vendas / totalItens) * 100 : 0,
        classe: pctAcum <= 80 || acum === x.vendas ? "A" : pctAcum <= 95 ? "B" : "C",
      }
    })

    const vendas = itens.map(i => ({
      ...i, plataforma: plataformaDaLoja(i.loja),
      lucro: i.custo === null ? null : i.valor - i.taxa - i.cupom - i.frete - i.custo,
    }))

    return NextResponse.json({
      period: { from, to }, previous: { from: prevFrom, to: prevTo }, loja,
      lojas: lojasRes.length ? lojasRes : ["SHP_MARI", "SHP_SAMU", "TKTK_SAMU"],
      totais: { ...tot, ticketMedio: tot.pedidos ? tot.vendas / tot.pedidos : 0, lucroMedio: tot.pedidos ? tot.lucro / tot.pedidos : 0 },
      anterior: totPrev,
      variacao: { vendas: variacao(tot.vendas, totPrev.vendas), lucro: variacao(tot.lucro, totPrev.lucro), pedidos: variacao(tot.pedidos, totPrev.pedidos) },
      incompletos, divergencias, faltando,
      daily,
      porLoja: [...porLoja.values()].sort((a, b) => b.vendas - a.vendas),
      produtos,
      vendas: vendas.slice(0, 1000),
      vendasTotal: vendas.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
