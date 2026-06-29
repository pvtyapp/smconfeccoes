import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    const dateCond = from && to
      ? `WHERE status != 'cancelado' AND data BETWEEN $1 AND $2`
      : `WHERE status != 'cancelado'`
    const params = from && to ? [from, to] : []

    // Pedidos no período — excluindo cancelados
    const { rows: pedidos } = await pool.query(`
      SELECT id, data, cliente, metros, metros_finais AS "metrosFinais",
             preco_cobrado AS "precoCobrado", observacao, status
      FROM dtf_pedidos
      ${dateCond}
      ORDER BY data DESC, id DESC
    `, params)

    // Usa metros_finais quando disponível (pronto/concluido), senão metros estimados
    const totalMetros  = pedidos.reduce((s, p) => s + Number(p.metrosFinais ?? p.metros ?? 0), 0)
    const totalReceita = pedidos.reduce((s, p) => s + (p.precoCobrado ? Number(p.precoCobrado) : 0), 0)

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
          SELECT COALESCE(SUM(COALESCE(metros_finais, metros, 0)), 0) AS total
          FROM dtf_pedidos
          WHERE status != 'cancelado'
            AND data >= $1 AND data <= $2
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

    // Metros por impressora
    const { rows: impressorasRows } = await pool.query(`
      SELECT impressora_id AS "impressoraId",
             SUM(COALESCE(metros_finais, metros, 0))::float AS metros,
             COUNT(*)::int AS pedidos
      FROM dtf_pedidos
      WHERE status != 'cancelado'
        AND impressora_id IS NOT NULL
        ${from && to ? "AND data BETWEEN $1 AND $2" : ""}
      GROUP BY impressora_id
      ORDER BY impressora_id
    `, from && to ? [from, to] : [])

    // Custo unitário médio por insumo (média ponderada de todas as entradas)
    const { rows: unitCostRows } = await pool.query(`
      SELECT insumo_id,
             SUM(custo_total) / NULLIF(SUM(quantidade), 0) AS custo_unitario
      FROM dtf_insumo_entradas
      WHERE custo_total IS NOT NULL
      GROUP BY insumo_id
    `)
    const unitCostMap = Object.fromEntries(unitCostRows.map(r => [r.insumo_id, Number(r.custo_unitario)]))

    // Insumos consumidos por impressora (somente saídas com impressora_id definido)
    const { rows: insumoPrinterRows } = await pool.query(`
      SELECT s.impressora_id AS "impressoraId",
             s.insumo_id     AS "insumoId",
             i.nome,
             i.unidade,
             SUM(s.quantidade)::float AS quantidade
      FROM dtf_insumo_saidas s
      JOIN dtf_insumos i ON i.id = s.insumo_id
      WHERE s.impressora_id IS NOT NULL
        ${from && to ? "AND s.data BETWEEN $1 AND $2" : ""}
      GROUP BY s.impressora_id, s.insumo_id, i.nome, i.unidade
      ORDER BY s.impressora_id, s.insumo_id
    `, from && to ? [from, to] : [])

    // Montar estrutura por impressora
    type ImpressoraInsumo = { insumoId: number; nome: string; unidade: string; quantidade: number; custo: number | null }
    const impressoraInsumos: Record<number, ImpressoraInsumo[]> = {}
    for (const row of insumoPrinterRows) {
      const imp = row.impressoraId as number
      if (!impressoraInsumos[imp]) impressoraInsumos[imp] = []
      const custo = unitCostMap[row.insumoId] != null
        ? row.quantidade * unitCostMap[row.insumoId]
        : null
      impressoraInsumos[imp].push({
        insumoId: row.insumoId,
        nome: row.nome,
        unidade: row.unidade,
        quantidade: row.quantidade,
        custo,
      })
    }

    const impressoras = impressorasRows.map(imp => {
      const ins = impressoraInsumos[imp.impressoraId] ?? []
      const custoTotalInsumos = ins.every(i => i.custo != null)
        ? ins.reduce((s, i) => s + (i.custo ?? 0), 0)
        : null
      const custoPorMetro = custoTotalInsumos != null && imp.metros > 0
        ? custoTotalInsumos / imp.metros
        : null
      return { ...imp, insumos: ins, custoTotalInsumos, custoPorMetro }
    })

    // Eficiência de film por impressora (todas as bobinas fechadas — all-time)
    const { rows: filmEfRows } = await pool.query(`
      SELECT impressora_id                                                       AS "impressoraId",
             COUNT(*)::int                                                       AS bobinas,
             SUM(tamanho_m)::float                                              AS "totalConsumedM",
             SUM(metros_usados)::float                                          AS "totalProducedM",
             SUM(desperdicio_m)::float                                          AS "totalWasteM",
             (SUM(desperdicio_m) / NULLIF(SUM(tamanho_m), 0) * 100)::float     AS "desperdicoPct",
             (SUM(metros_usados) / NULLIF(SUM(tamanho_m), 0) * 100)::float     AS "eficienciaPct"
      FROM dtf_film_bobinas
      WHERE fechada_em IS NOT NULL AND metros_usados IS NOT NULL
      GROUP BY impressora_id
      ORDER BY impressora_id
    `)

    return NextResponse.json({
      pedidos,
      totalMetros,
      totalReceita,
      insumos: insumosComCusto,
      custoCombinado: custoCombinado > 0 ? custoCombinado : null,
      impressoras,
      filmEficiencia: filmEfRows,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
