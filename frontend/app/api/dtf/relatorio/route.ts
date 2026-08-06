import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    // Só conta pedido concluído (fixa o "sem preço"), mas pela data em que foi
    // FEITO/IMPRESSO (p.data) — não pela data em que o status virou "concluído".
    // Pedido tirado às 22h e fechado no sistema só de manhã (depois da meia-
    // noite) continua contando no dia em que rodou na impressora, que é como
    // a produção confere na mão todo dia.
    const dateCond = from && to
      ? `WHERE p.status = 'concluido' AND p.data BETWEEN $1 AND $2`
      : `WHERE p.status = 'concluido'`
    const params = from && to ? [from, to] : []

    // Pedidos no período — cliente via contact_id (mesmo fallback do Top Clientes,
    // o campo de texto p.cliente não é mais preenchido por pedido nenhum)
    const { rows: pedidos } = await pool.query(`
      SELECT p.id, p.data, p.concluded_at AS "concludedAt", COALESCE(c.name, p.cliente) AS cliente,
             p.metros, p.metros_finais AS "metrosFinais",
             p.preco_cobrado AS "precoCobrado", p.observacao, p.status,
             p.due_date AS "dueDate", p.paid_at AS "paidAt"
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      ${dateCond}
      ORDER BY p.data DESC, p.id DESC
    `, params)

    const totalMetros  = pedidos.reduce((s, p) => s + Number(p.metrosFinais ?? p.metros ?? 0), 0)
    const totalReceita = pedidos.reduce((s, p) => s + (p.precoCobrado ? Number(p.precoCobrado) : 0), 0)

    // Todos os insumos
    const { rows: insumosBase } = await pool.query(`
      SELECT id, nome, unidade, grupo FROM dtf_insumos ORDER BY id
    `)

    // Custo unitário médio por insumo (all-time weighted avg)
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

    // Film insumo id
    const filmIdRow = await pool.query(
      `SELECT id FROM dtf_insumos WHERE LOWER(grupo) = 'film' ORDER BY id LIMIT 1`
    )
    const filmInsumoId: number | null = filmIdRow.rows[0]?.id ?? null

    // Film bobinas fechadas (for ciclosFechados + pctDesperdicioMedio)
    const { rows: filmFechadas } = await pool.query(`
      SELECT id, impressora_id, tamanho_m, metros_usados, desperdicio_m, aberta_em, fechada_em
      FROM dtf_film_bobinas
      WHERE fechada_em IS NOT NULL AND metros_usados IS NOT NULL AND metros_usados > 0
      ORDER BY fechada_em DESC
    `)

    // Film bobinas ativas (for loteAtivo + custoPorMetroAtual)
    const { rows: filmAtivas } = await pool.query(`
      SELECT b.id, b.impressora_id, b.tamanho_m, b.aberta_em,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.film_bobina_id = b.id AND p.status != 'cancelado'),
               0
             )::float AS metros_atuais
      FROM dtf_film_bobinas b
      WHERE b.fechada_em IS NULL
    `)

    // Total saídas all-time por insumo (fallback quando sem ciclos)
    const { rows: saidasTotaisRows } = await pool.query(`
      SELECT insumo_id, SUM(quantidade)::float AS total
      FROM dtf_insumo_saidas
      GROUP BY insumo_id
    `)
    const saidasTotaisMap: Record<number, number> = Object.fromEntries(
      saidasTotaisRows.map(r => [r.insumo_id, Number(r.total)])
    )

    // printer_refis data (table may not exist yet)
    type RefilAtivo = {
      insumo_id: number; impressora_id: number
      custo_total: number | null; aberta_em: string; metros_atuais: number
    }
    type RefilFechado = {
      id: number; insumo_id: number; impressora_id: number
      custo_total: number | null; aberta_em: string; fechada_em: string
      metros_no_ciclo: number | null; custo_por_metro: number | null
    }
    const refisAtivosMap: Record<number, RefilAtivo[]> = {}
    const refisFechadosMap: Record<number, RefilFechado[]> = {}

    try {
      const { rows: ra } = await pool.query(`
        SELECT r.insumo_id, r.impressora_id, r.custo_total, r.aberta_em,
               COALESCE(
                 (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                  FROM dtf_pedidos p
                  WHERE r.id = ANY(p.refil_ids) AND p.status != 'cancelado'),
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
        SELECT r.id, r.insumo_id, r.impressora_id, r.custo_total,
               r.aberta_em, r.fechada_em, r.metros_no_ciclo, r.custo_por_metro
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

    // Build insumos with cost data
    type CicloFechado = {
      id: number; abertoEm: string; fechadoEm: string
      custo: number; metrosNoPeriodo: number; custoPorMetro: number | null
      metrosInicial?: number | null; desperdicio?: number | null; pctDesperdicio?: number | null
    }

    const insumosComCusto = insumosBase.map(ins => {
      const isFilm = filmInsumoId != null && ins.id === filmInsumoId
      const custo_unitario = unitCostMap[ins.id] ?? null

      let custoPorMetroAtual: number | null = null
      let metrosAcumulados = 0
      let loteAtivo: { abertoEm: string; custo: number } | null = null
      const ciclosFechados: CicloFechado[] = []
      let pctDesperdicioMedio: number | null = null

      if (isFilm) {
        // Film: use dtf_film_bobinas
        for (const b of filmFechadas) {
          const custoB = custo_unitario != null ? custo_unitario * Number(b.tamanho_m) : 0
          const mn = Number(b.metros_usados)
          const mi = Number(b.tamanho_m)
          const desp = Math.max(0, mi - mn)
          ciclosFechados.push({
            id: b.id,
            abertoEm: b.aberta_em,
            fechadoEm: b.fechada_em,
            custo: custoB,
            metrosNoPeriodo: mn,
            custoPorMetro: custo_unitario != null && mn > 0 ? (custo_unitario * mi) / mn : null,
            metrosInicial: mi,
            desperdicio: desp,
            pctDesperdicio: mi > 0 ? (desp / mi) * 100 : null,
          })
        }

        // Active bobina(s)
        const totalMetrosAtivos = filmAtivas.reduce((s, b) => s + Number(b.metros_atuais), 0)
        const totalCustoAtivo = filmAtivas.reduce((s, b) => {
          return s + (custo_unitario != null ? custo_unitario * Number(b.tamanho_m) : 0)
        }, 0)
        metrosAcumulados = totalMetrosAtivos

        if (filmAtivas.length > 0) {
          loteAtivo = { abertoEm: filmAtivas[0].aberta_em, custo: totalCustoAtivo }
          custoPorMetroAtual = totalCustoAtivo > 0 && totalMetrosAtivos > 0
            ? totalCustoAtivo / totalMetrosAtivos
            : (ciclosFechados[0]?.custoPorMetro ?? null)
        } else if (ciclosFechados.length > 0) {
          custoPorMetroAtual = ciclosFechados[0].custoPorMetro
        }

        // pctDesperdicioMedio (weighted)
        const comDados = ciclosFechados.filter(c => Number(c.metrosInicial ?? 0) > 0)
        const totInicial = comDados.reduce((s, c) => s + Number(c.metrosInicial ?? 0), 0)
        const totDesp    = comDados.reduce((s, c) => s + Number(c.desperdicio   ?? 0), 0)
        pctDesperdicioMedio = totInicial > 0 ? (totDesp / totInicial) * 100 : null

      } else {
        // Tintas/Poliamida: use dtf_printer_refis
        const refisAtivos = refisAtivosMap[ins.id] ?? []
        const refisFechados = refisFechadosMap[ins.id] ?? []

        for (const r of refisFechados) {
          ciclosFechados.push({
            id: r.id,
            abertoEm: r.aberta_em,
            fechadoEm: r.fechada_em,
            custo: r.custo_total ? Number(r.custo_total) : 0,
            metrosNoPeriodo: r.metros_no_ciclo ? Number(r.metros_no_ciclo) : 0,
            custoPorMetro: r.custo_por_metro ? Number(r.custo_por_metro) : null,
          })
        }

        if (refisAtivos.length > 0) {
          const totalCusto = refisAtivos.reduce((s, r) => s + (r.custo_total ? Number(r.custo_total) : 0), 0)
          const totalMetrosAtivos = refisAtivos.reduce((s, r) => s + Number(r.metros_atuais), 0)
          metrosAcumulados = totalMetrosAtivos

          const maisRecente = refisAtivos.reduce((prev, curr) =>
            new Date(curr.aberta_em) > new Date(prev.aberta_em) ? curr : prev
          )
          if (maisRecente.custo_total) {
            loteAtivo = { abertoEm: maisRecente.aberta_em, custo: Number(maisRecente.custo_total) }
          }

          custoPorMetroAtual = totalCusto > 0 && totalMetrosAtivos > 0
            ? totalCusto / totalMetrosAtivos
            : (ciclosFechados[0]?.custoPorMetro ?? null)
        } else if (ciclosFechados.length > 0) {
          custoPorMetroAtual = ciclosFechados[0].custoPorMetro
        } else if (custo_unitario != null && totalMetros > 0) {
          // No cycle data yet — estimate from all-time saídas / period metros
          const totalSaidas = saidasTotaisMap[ins.id] ?? 0
          if (totalSaidas > 0) {
            custoPorMetroAtual = custo_unitario * (totalSaidas / totalMetros)
          }
        }
      }

      return {
        id: ins.id, nome: ins.nome, unidade: ins.unidade,
        custoPorMetroAtual, metrosAcumulados, ciclosFechados, loteAtivo, pctDesperdicioMedio,
      }
    })

    const custoCombinado = insumosComCusto.reduce((s, i) => s + (i.custoPorMetroAtual ?? 0), 0)

    // Metros por impressora (period)
    const { rows: impressorasRows } = await pool.query(`
      SELECT impressora_id AS "impressoraId",
             SUM(COALESCE(metros_finais, metros, 0))::float AS metros,
             COUNT(*)::int AS pedidos
      FROM dtf_pedidos
      WHERE status != 'cancelado' AND impressora_id IS NOT NULL
        ${from && to ? "AND data BETWEEN $1 AND $2" : ""}
      GROUP BY impressora_id
      ORDER BY impressora_id
    `, from && to ? [from, to] : [])

    // Custo unitário médio por insumo (já calculado acima)
    // Insumos por impressora — saídas com impressora_id (inclui film monitor + printer_refis)
    const { rows: insumoPrinterRows } = await pool.query(`
      SELECT s.impressora_id AS "impressoraId",
             s.insumo_id     AS "insumoId",
             i.nome, i.unidade,
             SUM(s.quantidade)::float AS quantidade
      FROM dtf_insumo_saidas s
      JOIN dtf_insumos i ON i.id = s.insumo_id
      WHERE s.impressora_id IS NOT NULL
        ${from && to ? "AND s.data BETWEEN $1 AND $2" : ""}
      GROUP BY s.impressora_id, s.insumo_id, i.nome, i.unidade
      ORDER BY s.impressora_id, s.insumo_id
    `, from && to ? [from, to] : [])

    type ImpressoraInsumo = { insumoId: number; nome: string; unidade: string; quantidade: number; custo: number | null }
    const impressoraInsumos: Record<number, ImpressoraInsumo[]> = {}
    for (const row of insumoPrinterRows) {
      const imp = row.impressoraId as number
      if (!impressoraInsumos[imp]) impressoraInsumos[imp] = []
      const custo = unitCostMap[row.insumoId] != null
        ? row.quantidade * unitCostMap[row.insumoId]
        : null
      impressoraInsumos[imp].push({ insumoId: row.insumoId, nome: row.nome, unidade: row.unidade, quantidade: row.quantidade, custo })
    }

    const impressoras = impressorasRows.map(imp => {
      const ins = impressoraInsumos[imp.impressoraId] ?? []
      const custoTotalInsumos = ins.every(i => i.custo != null)
        ? ins.reduce((s, i) => s + (i.custo ?? 0), 0)
        : null
      const custoPorMetro = custoTotalInsumos != null && imp.metros > 0
        ? custoTotalInsumos / imp.metros : null
      return { ...imp, insumos: ins, custoTotalInsumos, custoPorMetro }
    })

    // Eficiência de film por impressora (all-time)
    const { rows: filmEfRows } = await pool.query(`
      SELECT impressora_id                                                    AS "impressoraId",
             COUNT(*)::int                                                    AS bobinas,
             SUM(tamanho_m)::float                                           AS "totalConsumedM",
             SUM(metros_usados)::float                                       AS "totalProducedM",
             SUM(desperdicio_m)::float                                       AS "totalWasteM",
             (SUM(desperdicio_m) / NULLIF(SUM(tamanho_m), 0) * 100)::float  AS "desperdicoPct",
             (SUM(metros_usados) / NULLIF(SUM(tamanho_m), 0) * 100)::float  AS "eficienciaPct"
      FROM dtf_film_bobinas
      WHERE fechada_em IS NOT NULL AND metros_usados IS NOT NULL
      GROUP BY impressora_id
      ORDER BY impressora_id
    `)

    // Top clientes do período — via contact_id (pedidos de chatbot/autoatendimento
    // não preenchem mais o campo de texto "cliente"; agrupar por ele juntava tudo
    // numa única linha "(sem nome)"). Agrupa por contact_id pra não juntar dois
    // clientes diferentes que por acaso tenham o mesmo nome.
    const { rows: topClientes } = await pool.query(`
      SELECT COALESCE(c.name, p.cliente, '(sem nome)') AS cliente,
             COUNT(*)::int AS pedidos,
             SUM(COALESCE(p.metros_finais, p.metros, 0))::float AS metros,
             COALESCE(SUM(p.preco_cobrado), 0)::float AS receita
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.status = 'concluido'
        ${from && to ? "AND p.data BETWEEN $1 AND $2" : ""}
      GROUP BY p.contact_id, COALESCE(c.name, p.cliente, '(sem nome)')
      ORDER BY receita DESC
      LIMIT 10
    `, from && to ? [from, to] : [])

    return NextResponse.json({
      pedidos,
      totalMetros,
      totalReceita,
      insumos: insumosComCusto,
      custoCombinado: custoCombinado > 0 ? custoCombinado : null,
      impressoras,
      filmEficiencia: filmEfRows,
      topClientes,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
