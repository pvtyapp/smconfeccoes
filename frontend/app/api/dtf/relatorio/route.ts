import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    const dateCond = from && to ? `WHERE data BETWEEN $1 AND $2` : ""
    const params   = from && to ? [from, to] : []

    // Pedidos no período
    const { rows: pedidos } = await pool.query(`
      SELECT id, data, cliente, metros, preco_cobrado AS "precoCobrado", observacao
      FROM dtf_pedidos
      ${dateCond}
      ORDER BY data DESC, id DESC
    `, params)

    const totalMetros   = pedidos.reduce((s, p) => s + Number(p.metros), 0)
    const totalReceita  = pedidos.reduce((s, p) => s + (p.precoCobrado ? Number(p.precoCobrado) : 0), 0)

    // Custo por insumo — lotes fechados no período + lote ativo atual
    const today = todayBR()
    const { rows: insumos } = await pool.query(`
      SELECT i.id, i.nome, i.unidade,
        json_agg(
          json_build_object(
            'id',              l.id,
            'custo',           l.custo,
            'abertoEm',        l.aberto_em,
            'fechadoEm',       l.fechado_em,
            'metrosNoPeriodo', l.metros_no_periodo,
            'custoPorMetro',   l.custo_por_metro,
            'metrosInicial',   l.quantidade
          ) ORDER BY l.aberto_em DESC
        ) FILTER (WHERE l.id IS NOT NULL) AS lotes
      FROM dtf_insumos i
      LEFT JOIN dtf_insumo_lotes l ON l.insumo_id = i.id
      GROUP BY i.id, i.nome, i.unidade
      ORDER BY i.id
    `)

    const insumosComCusto = await Promise.all(insumos.map(async (ins) => {
      const lotes = ins.lotes || []
      const ativo = lotes.find((l: { fechadoEm: string | null }) => !l.fechadoEm)

      let custoPorMetroAtual: number | null = null
      let metrosAcumulados = 0

      if (ativo) {
        const { rows } = await pool.query(`
          SELECT COALESCE(SUM(metros), 0) AS total
          FROM dtf_pedidos
          WHERE data >= $1 AND data <= $2
        `, [ativo.abertoEm, today])
        metrosAcumulados = Number(rows[0].total)
        custoPorMetroAtual = metrosAcumulados > 0 ? Number(ativo.custo) / metrosAcumulados : null
      }

      // Ciclos fechados
      type LoteRaw = {
        id: number; abertoEm: string; fechadoEm: string | null
        custo: number; metrosNoPeriodo: number | null; custoPorMetro: number | null
        metrosInicial: number | null
      }
      const ciclosFechadosRaw = (lotes as LoteRaw[]).filter(l => l.fechadoEm && l.custoPorMetro !== null)

      const ciclosFechados = ciclosFechadosRaw.map(l => {
        if (ins.unidade !== "metro" || !l.metrosInicial) return l
        const mi = Number(l.metrosInicial)
        const mn = Number(l.metrosNoPeriodo ?? 0)
        const desperdicio = mi > 0 ? Math.max(0, mi - mn) : null
        const pctDesperdicio = mi > 0 && desperdicio !== null ? (desperdicio / mi) * 100 : null
        return { ...l, desperdicio, pctDesperdicio }
      })

      // % desperdício médio ponderado — só para insumos em metro (Film)
      let pctDesperdicioMedio: number | null = null
      if (ins.unidade === "metro") {
        type CicloComDesp = { metrosInicial?: number | null; desperdicio?: number | null }
        const comDados = (ciclosFechados as CicloComDesp[]).filter(c => Number(c.metrosInicial ?? 0) > 0)
        const totalInicial = comDados.reduce((s, c) => s + Number(c.metrosInicial ?? 0), 0)
        const totalDesp    = comDados.reduce((s, c) => s + Number(c.desperdicio   ?? 0), 0)
        pctDesperdicioMedio = totalInicial > 0 ? (totalDesp / totalInicial) * 100 : null
      }

      return {
        id: ins.id,
        nome: ins.nome,
        unidade: ins.unidade,
        custoPorMetroAtual,
        metrosAcumulados,
        ciclosFechados,
        loteAtivo: ativo || null,
        pctDesperdicioMedio,
      }
    }))

    // Custo combinado atual por metro
    const custoCombinado = insumosComCusto.reduce((s, i) => {
      return s + (i.custoPorMetroAtual ?? 0)
    }, 0)

    return NextResponse.json({
      pedidos,
      totalMetros,
      totalReceita,
      insumos: insumosComCusto,
      custoCombinado: custoCombinado > 0 ? custoCombinado : null,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
