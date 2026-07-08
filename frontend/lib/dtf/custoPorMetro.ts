import { pool } from "@/lib/db"

// Custo atual por metro de DTF, por insumo (film + tintas/poliamida) — baseado no
// ciclo de consumo mais recente (bobina/refil aberto, ou último fechado se não tem
// aberto). Usado tanto pela página "Relatório DTF" (detalhe por insumo) quanto pelo
// Relatório Financeiro (soma tudo pra descontar do DRE) — extraído aqui pra não
// duplicar essa lógica em 2 lugares e eles saírem divergentes.

export type DtfInsumoCusto = {
  id: number
  nome: string
  unidade: string
  custoPorMetroAtual: number | null
  metrosAcumulados: number
}

export async function getDtfInsumosComCusto(): Promise<DtfInsumoCusto[]> {
  const { rows: insumosBase } = await pool.query(`
    SELECT id, nome, unidade, grupo FROM dtf_insumos ORDER BY id
  `)

  const { rows: unitCostRows } = await pool.query(`
    SELECT insumo_id,
           SUM(custo_total) / NULLIF(SUM(quantidade), 0) AS custo_unitario
    FROM dtf_insumo_entradas
    WHERE custo_total IS NOT NULL
    GROUP BY insumo_id
  `)
  const unitCostMap: Record<number, number> = Object.fromEntries(
    unitCostRows.map(r => [r.insumo_id, Number(r.custo_unitario)])
  )

  const filmIdRow = await pool.query(
    `SELECT id FROM dtf_insumos WHERE LOWER(grupo) = 'film' ORDER BY id LIMIT 1`
  )
  const filmInsumoId: number | null = filmIdRow.rows[0]?.id ?? null

  const { rows: filmFechadas } = await pool.query(`
    SELECT id, impressora_id, tamanho_m, metros_usados, desperdicio_m, aberta_em, fechada_em
    FROM dtf_film_bobinas
    WHERE fechada_em IS NOT NULL AND metros_usados IS NOT NULL AND metros_usados > 0
    ORDER BY fechada_em DESC
  `)

  const { rows: filmAtivas } = await pool.query(`
    SELECT b.id, b.impressora_id, b.tamanho_m, b.aberta_em,
           COALESCE(
             (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
              FROM dtf_pedidos p
              WHERE p.impressora_id = b.impressora_id
                AND p.created_at >= b.aberta_em
                AND p.status != 'cancelado'),
             0
           )::float AS metros_atuais
    FROM dtf_film_bobinas b
    WHERE b.fechada_em IS NULL
  `)

  type RefilAtivo = { insumo_id: number; impressora_id: number; custo_total: number | null; aberta_em: string; metros_atuais: number }
  type RefilFechado = { id: number; insumo_id: number; custo_por_metro: number | null }
  const refisAtivosMap: Record<number, RefilAtivo[]> = {}
  const refisFechadosMap: Record<number, RefilFechado[]> = {}

  try {
    const { rows: ra } = await pool.query(`
      SELECT r.insumo_id, r.impressora_id, r.custo_total, r.aberta_em,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.impressora_id = r.impressora_id
                  AND p.created_at >= r.aberta_em
                  AND p.status != 'cancelado'),
               0
             )::float AS metros_atuais
      FROM dtf_printer_refis r
      WHERE r.fechada_em IS NULL
    `)
    for (const r of ra) {
      if (!refisAtivosMap[r.insumo_id]) refisAtivosMap[r.insumo_id] = []
      refisAtivosMap[r.insumo_id].push(r)
    }

    const { rows: rf } = await pool.query(`
      SELECT r.id, r.insumo_id, r.custo_por_metro
      FROM dtf_printer_refis r
      WHERE r.fechada_em IS NOT NULL
      ORDER BY r.fechada_em DESC
    `)
    for (const r of rf) {
      if (!refisFechadosMap[r.insumo_id]) refisFechadosMap[r.insumo_id] = []
      refisFechadosMap[r.insumo_id].push(r)
    }
  } catch {
    // dtf_printer_refis not migrated yet — silently ignore
  }

  return insumosBase.map(ins => {
    const isFilm = filmInsumoId != null && ins.id === filmInsumoId
    const custo_unitario = unitCostMap[ins.id] ?? null

    let custoPorMetroAtual: number | null = null
    let metrosAcumulados = 0

    if (isFilm) {
      const ciclosFechados = filmFechadas.map(b => {
        const mn = Number(b.metros_usados)
        const mi = Number(b.tamanho_m)
        return { custoPorMetro: custo_unitario != null && mn > 0 ? (custo_unitario * mi) / mn : null }
      })

      const totalMetrosAtivos = filmAtivas.reduce((s, b) => s + Number(b.metros_atuais), 0)
      const totalCustoAtivo = filmAtivas.reduce((s, b) =>
        s + (custo_unitario != null ? custo_unitario * Number(b.tamanho_m) : 0), 0)
      metrosAcumulados = totalMetrosAtivos

      if (filmAtivas.length > 0) {
        custoPorMetroAtual = totalCustoAtivo > 0 && totalMetrosAtivos > 0
          ? totalCustoAtivo / totalMetrosAtivos
          : (ciclosFechados[0]?.custoPorMetro ?? null)
      } else if (ciclosFechados.length > 0) {
        custoPorMetroAtual = ciclosFechados[0].custoPorMetro
      }
    } else {
      const refisAtivos = refisAtivosMap[ins.id] ?? []
      const refisFechados = refisFechadosMap[ins.id] ?? []

      if (refisAtivos.length > 0) {
        const totalCusto = refisAtivos.reduce((s, r) => s + (r.custo_total ? Number(r.custo_total) : 0), 0)
        const totalMetrosAtivos = refisAtivos.reduce((s, r) => s + Number(r.metros_atuais), 0)
        metrosAcumulados = totalMetrosAtivos
        custoPorMetroAtual = totalCusto > 0 && totalMetrosAtivos > 0
          ? totalCusto / totalMetrosAtivos
          : (refisFechados[0]?.custo_por_metro ?? null)
      } else if (refisFechados.length > 0) {
        custoPorMetroAtual = refisFechados[0].custo_por_metro
      }
    }

    return { id: ins.id, nome: ins.nome, unidade: ins.unidade, custoPorMetroAtual, metrosAcumulados }
  })
}

// Soma o custo por metro de TODOS os insumos (film + tintas + poliamida) — o custo
// combinado de produzir 1 metro de DTF hoje.
export async function getDtfCustoPorMetroAtual(): Promise<number | null> {
  const insumos = await getDtfInsumosComCusto()
  if (insumos.every(i => i.custoPorMetroAtual == null)) return null
  return insumos.reduce((s, i) => s + (i.custoPorMetroAtual ?? 0), 0)
}
