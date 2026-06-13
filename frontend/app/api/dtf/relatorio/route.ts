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
            'custoPorMetro',   l.custo_por_metro
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

      // Ciclos fechados no período
      const ciclosFechados = lotes.filter((l: { fechadoEm: string | null; custoPorMetro: number | null }) =>
        l.fechadoEm && l.custoPorMetro !== null
      )

      return {
        id: ins.id,
        nome: ins.nome,
        unidade: ins.unidade,
        custoPorMetroAtual,
        metrosAcumulados,
        ciclosFechados,
        loteAtivo: ativo || null,
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
