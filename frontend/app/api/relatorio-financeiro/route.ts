import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { exigirFinanceiro } from "@/lib/acesso"
import { recebimentosPrazo } from "@/lib/reports/receitaCaixa"

// GET /api/relatorio-financeiro?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  const semPermissao = await exigirFinanceiro()
  if (semPermissao) return semPermissao

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

    // defect_stock.resolved_at/sale_price só existem depois que alguém marca uma
    // avaria como vendida pela 1a vez (criadas sob demanda em /api/defect-stock/[id])
    await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10,2)`).catch(() => {})

    // 1. Orders no período (status != cancelado, source pdv/whatsapp/manual, sem COB-)
    const { rows: orders } = await pool.query(`
      SELECT
        o.id, o.number, o.source, o.status,
        o.total_value AS "totalValue",
        o.due_date    AS "dueDate",
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
        WHERE TRIM(LOWER(name)) = TRIM(LOWER(oi.product_name))
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END
        LIMIT 1
      ) p ON true
      WHERE o.status != 'cancelado'
        AND o.source IN ('pdv', 'whatsapp', 'site')
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

    // 3b. Contas a pagar quitadas no período — antes não entrava na DRE de
    // jeito nenhum (só Custo Operacional/Variável). Conta pelo dia em que foi
    // PAGA (regime de caixa, igual o resto do financeiro), não pelo vencimento.
    const { rows: payablesRows } = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(paid_amount, amount)), 0)::float AS total,
             COUNT(*)::int AS count
      FROM payables
      WHERE paid_at IS NOT NULL
        AND DATE(paid_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    `, [from, to])

    // 4. Diagnóstico: produtos cadastrados nos pedidos mas sem custo preenchido
    const { rows: semCustoRows } = await pool.query(`
      SELECT DISTINCT oi.product_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p
        ON TRIM(LOWER(p.name)) = TRIM(LOWER(oi.product_name))
      WHERE o.status != 'cancelado'
        AND o.source IN ('pdv', 'whatsapp', 'site')
        AND o.number NOT LIKE 'COB-%'
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
        AND (p.material_cost IS NULL OR p.material_cost = 0)
      ORDER BY oi.product_name
    `, [from, to])

    // 5a. Receita de avarias vendidas no período
    const { rows: avariaVendas } = await pool.query(`
      SELECT COALESCE(SUM(sale_price), 0)::float AS total
      FROM defect_stock
      WHERE disposition = 'vendido'
        AND sale_price IS NOT NULL
        AND resolved_at IS NOT NULL
        AND DATE(resolved_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    `, [from, to])

    // 5b. Perdas por descarte (qty × material_cost do produto). Nunca
    // average_cost da variante: esse campo pode carregar Custo de Costura
    // injetado por concludeOrder.ts/calculate_sku_costs ou por um Fechamento
    // de Custo antigo (/api/cost-closures) — material_cost é a única fonte
    // de verdade de custo por peça. Decidido com o PIV em 2026-08-31.
    const { rows: avariaDescartes } = await pool.query(`
      SELECT COALESCE(SUM(ds.qty * COALESCE(p.material_cost, 0)), 0)::float AS total
      FROM defect_stock ds
      LEFT JOIN LATERAL (
        SELECT material_cost FROM products
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(ds.product_name)) AND status = 'active'
        LIMIT 1
      ) p ON true
      WHERE ds.disposition = 'descartado'
        AND ds.resolved_at IS NOT NULL
        AND DATE(ds.resolved_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2
    `, [from, to])

    // 6. Entradas de matéria-prima compradas no período
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

    // Marketplace (PIV 06/11): resultado real das lojas da SM (SHP_MARI, SHP_SAMU,
    // TKTK_SAMU) que o fechamento diário do PC 01 grava em marketplace_fechamentos
    // (vendas, taxas, cupom, frete, ads e custo das peças). Antes isso aqui era só
    // o custo das peças separadas, sem receita; agora entra no DRE completo.
    const { rows: mktLojas } = await pool.query(`
      SELECT loja,
             SUM(pedidos)::int AS pedidos, SUM(pecas)::int AS pecas,
             SUM(vendas)::float AS vendas, SUM(taxas)::float AS taxas, SUM(cupom)::float AS cupom,
             SUM(frete)::float AS frete, SUM(ads)::float AS ads,
             COALESCE(SUM(custo), 0)::float AS custo,
             BOOL_OR(custo IS NULL) OR SUM(itens_sem_custo) > 0 AS "custoIncompleto",
             COUNT(*)::int AS dias
      FROM marketplace_fechamentos
      WHERE dia BETWEEN $1 AND $2
      GROUP BY loja ORDER BY loja
    `, [from, to]).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    const lojasMkt = mktLojas.map(r => ({
      loja: String(r.loja), pedidos: Number(r.pedidos), pecas: Number(r.pecas), dias: Number(r.dias),
      vendas: Number(r.vendas), taxas: Number(r.taxas), cupom: Number(r.cupom), frete: Number(r.frete),
      ads: Number(r.ads), custo: Number(r.custo), custoIncompleto: Boolean(r.custoIncompleto),
    }))
    const somaMkt = (k: "vendas" | "taxas" | "cupom" | "frete" | "ads" | "custo" | "pecas") => lojasMkt.reduce((s, l) => s + l[k], 0)
    const marketplace = {
      custo:           somaMkt("custo"),
      pecas:           somaMkt("pecas"),
      separacoes:      0,
      custoIncompleto: lojasMkt.some(l => l.custoIncompleto),
      vendas:          somaMkt("vendas"),
      lojas:           lojasMkt,
    }

    // Alíquota de imposto sobre a venda (Simples etc.), em %. Configurável no próprio
    // relatório; começa em 0 até o PIV informar (06/11).
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).catch(() => {})
    const { rows: aliqRows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'dre_aliquota_imposto'`).catch(() => ({ rows: [] as { value: string }[] }))
    const aliquota = Math.max(0, Number(String(aliqRows[0]?.value ?? "0").replace(",", ".")) || 0)

    // DTF pedidos concluídos no período — pela data em que o pedido foi FEITO
    // (p.data), não pela data em que fechou no sistema (mesmo critério do
    // Relatório DTF/Vendas — pedido tirado à noite e concluído só de manhã
    // continua contando no dia em que foi impresso de verdade).
    //
    // Venda a prazo (PIV 13/11/2026): DTF com vencimento não entra na receita
    // no dia da venda; entra cada baixa no dia em que o dinheiro chegou
    // (recebimentosPrazo). Metros e quantidade continuam pelo dia da venda.
    const { rows: dtfRows } = await pool.query(`
      SELECT COALESCE(SUM(preco_cobrado) FILTER (WHERE due_date IS NULL), 0)::float AS "totalAvista",
             COALESCE(SUM(preco_cobrado), 0)::float AS "totalVendido",
             COUNT(*)::int AS count,
             COALESCE(SUM(COALESCE(metros_finais, metros, 0)) FILTER (WHERE due_date IS NULL), 0)::float AS "metrosAvista",
             COALESCE(SUM(COALESCE(metros_finais, metros, 0)), 0)::float AS metros
      FROM dtf_pedidos
      WHERE status = 'concluido'
        AND data BETWEEN $1 AND $2
    `, [from, to])
    const recebimentos   = await recebimentosPrazo(from, to)
    const recProduto     = recebimentos.filter(r => r.kind === "produto")
    const recDtf         = recebimentos.filter(r => r.kind === "dtf")
    const receitaDtf     = Number(dtfRows[0]?.totalAvista ?? 0) + recDtf.reduce((s, r) => s + r.amount, 0)
    const vendidoDtf     = Number(dtfRows[0]?.totalVendido ?? 0)
    const dtfCount       = Number(dtfRows[0]?.count ?? 0)
    const metrosDtf      = Number(dtfRows[0]?.metros ?? 0)
    const metrosDtfAvista = Number(dtfRows[0]?.metrosAvista ?? 0)

    // Custo do DTF — mesma fonte usada por qualquer outro produto: material_cost
    // cadastrado no produto "DTF 60cm" (mesmo cadastro que já é fonte única de
    // preço em /api/dtf/preco). O monitor de insumo (film/tinta/poliamida) é só
    // um indicador operacional de consumo/desperdício — nunca entra no financeiro,
    // porque o custo/metro dele varia (ciclo recém-aberto x ciclo maduro) e não
    // representa o custo real de produzir 1 metro de DTF.
    const { rows: dtfProdutoRows } = await pool.query(`
      SELECT name, material_cost FROM products
      WHERE LOWER(name) LIKE 'dtf%' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1
    `)
    const dtfProdutoNome   = dtfProdutoRows[0]?.name ?? "DTF"
    const custoDtfUnitario = dtfProdutoRows[0]?.material_cost != null
      ? Number(dtfProdutoRows[0].material_cost) : null

    // ── Calcular DRE ──────────────────────────────────────────────────────────
    // Kanban 3 estágios: "pago" deixou de existir como status — todo pedido que
    // recebia pagamento e concluía (ou concluía a prazo) já cai direto em
    // "concluido" agora, sem parar num status intermediário.
    // Venda feita = concluído, ou PDV a prazo ainda "pronto" (fica assim até quitar).
    const concluded = orders.filter(o => o.status === "concluido" || (o.source === "pdv" && o.status === "pronto" && o.dueDate))
    // Só a venda à vista soma receita/custo no dia da venda; a prazo entra pelas baixas (recProduto).
    const avista    = concluded.filter(o => !o.dueDate)

    const receitaAvarias  = Number(avariaVendas[0]?.total   ?? 0)
    const perdasDescarte  = Number(avariaDescartes[0]?.total ?? 0)

    // Receita bruta — dinheiro que entrou: pedidos à vista + baixas de prazo
    // dadas no período + DTF (mesma regra) + avarias vendidas
    const receitaOrdens = avista.reduce((s: number, o: { totalValue: string | null }) => s + Number(o.totalValue ?? 0), 0)
      + recProduto.reduce((s, r) => s + r.amount, 0)
    const receitaBruta  = receitaOrdens + receitaDtf + receitaAvarias

    // Custo de insumos (material_cost × qty) — só para pedidos concluídos
    let custoInsumos      = 0
    let custoInsumosKnown = false
    const byProduct: Map<string, { revenue: number; cost: number; qty: number; hasCost: boolean }> = new Map()

    // Ranking por produto = o que foi VENDIDO no período (à vista e a prazo,
    // pelo dia da venda). Custo de insumos do DRE = só o que acompanha o
    // dinheiro do período (à vista + parte paga do prazo).
    for (const o of concluded) {
      for (const item of (o.items ?? [])) {
        const lineRevenue = (item.unitPrice ?? 0) * item.qty
        const cur = byProduct.get(item.productName) ?? { revenue: 0, cost: 0, qty: 0, hasCost: false }
        cur.revenue += lineRevenue
        cur.qty     += item.qty
        if (item.costPrice != null) {
          const lineCost = item.costPrice * item.qty
          if (!o.dueDate) { custoInsumos += lineCost; custoInsumosKnown = true }
          cur.cost    += lineCost
          cur.hasCost  = true
        }
        byProduct.set(item.productName, cur)
      }
    }
    for (const r of recProduto) {
      if (r.custo != null) { custoInsumos += r.custo; custoInsumosKnown = true }
    }

    // DTF entra no mesmo modelo dos demais produtos — 1 "unidade" = 1 metro,
    // custo e receita vindos do cadastro do produto (nunca do monitor de insumo).
    if (metrosDtf > 0) {
      const cur = byProduct.get(dtfProdutoNome) ?? { revenue: 0, cost: 0, qty: 0, hasCost: false }
      cur.revenue += vendidoDtf
      cur.qty     += metrosDtf
      if (custoDtfUnitario != null) {
        cur.cost    += custoDtfUnitario * metrosDtf
        cur.hasCost  = true
      }
      byProduct.set(dtfProdutoNome, cur)
    }
    const custoDtfCaixa = custoDtfUnitario != null
      ? custoDtfUnitario * metrosDtfAvista + recDtf.reduce((s, r) => s + (r.custo ?? 0), 0)
      : null
    if (custoDtfCaixa != null && (metrosDtfAvista > 0 || recDtf.length > 0)) {
      custoInsumos      += custoDtfCaixa
      custoInsumosKnown  = true
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

    const custoVariavel  = Number(varCosts[0]?.total ?? 0)
    const despesasPagas  = Number(payablesRows[0]?.total ?? 0)
    const lucroBruto     = custoInsumosKnown ? receitaBruta - custoInsumos : null
    // Resultado desconta só Custo Fixo (aluguel/energia, rateado por dias
    // corridos) e Perdas por Descarte (dado real do estoque de avarias).
    // Custo de Costura, Custo Variável e Contas a Pagar quitadas viram
    // informativos nas próprias telas: o material_cost cadastrado no produto
    // já embute mão de obra, é a única fonte de verdade de custo por peça
    // (confirmado no cadastro: labor_cost/additional_costs sempre zerados,
    // tudo é lançado direto em material_cost). Decidido com o PIV em 2026-08-31.
    const resultadoOp    = lucroBruto !== null
      ? lucroBruto - custoFixo - perdasDescarte
      : null

    const totalPecas  = concluded.reduce((s: number, o: { items: Array<{ qty: number }> | null }) =>
      s + (o.items ?? []).reduce((si: number, i: { qty: number }) => si + i.qty, 0), 0)
    const vendidoOrdens = concluded.reduce((s: number, o: { totalValue: string | null }) => s + Number(o.totalValue ?? 0), 0)
    const ticketMedio = concluded.length + dtfCount > 0 ? (vendidoOrdens + vendidoDtf) / (concluded.length + dtfCount) : 0

    // Custo das peças por canal (mesma regra do dinheiro), pro lucro por canal
    const custoCanal: Record<string, number> = {}
    for (const o of avista) {
      for (const item of (o.items ?? [])) {
        if (item.costPrice != null) custoCanal[o.source] = (custoCanal[o.source] ?? 0) + item.costPrice * item.qty
      }
    }
    for (const r of recProduto) {
      if (r.custo != null) custoCanal[r.source] = (custoCanal[r.source] ?? 0) + r.custo
    }

    // Revenue by channel — à vista + baixas de prazo do período
    const byChannel: Record<string, number> = {}
    for (const o of avista) {
      byChannel[o.source] = (byChannel[o.source] ?? 0) + Number(o.totalValue ?? 0)
    }
    for (const r of recProduto) {
      byChannel[r.source] = (byChannel[r.source] ?? 0) + r.amount
    }
    if (receitaDtf > 0) {
      byChannel["dtf"] = receitaDtf
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

    // ── DRE completo (PIV 06/11): lucro de verdade, com o marketplace dentro ──
    const r2 = (v: number) => Math.round(v * 100) / 100
    const receitaLojaTotal = receitaBruta + marketplace.vendas
    const impostos         = r2(receitaLojaTotal * aliquota / 100)
    const deducoesMkt      = somaMkt("taxas") + somaMkt("cupom") + somaMkt("frete")
    const receitaLiquida   = receitaLojaTotal - deducoesMkt - impostos
    const cmv              = (custoInsumosKnown ? custoInsumos : 0) + marketplace.custo
    const lucroBrutoTotal  = receitaLiquida - cmv
    const despesasVenda    = somaMkt("ads") + custoVariavel
    const lucroLiquido     = lucroBrutoTotal - despesasVenda - custoFixo - perdasDescarte
    const completo = {
      aliquota,
      receitaBruta: receitaLojaTotal,
      receitaLoja: receitaBruta,
      receitaMarketplace: marketplace.vendas,
      taxasMarketplace: somaMkt("taxas"), cupomMarketplace: somaMkt("cupom"), freteMarketplace: somaMkt("frete"),
      impostos,
      receitaLiquida,
      custoPecasLoja: custoInsumosKnown ? custoInsumos : null,
      custoPecasMarketplace: marketplace.custo,
      cmv,
      lucroBruto: lucroBrutoTotal,
      adsMarketplace: somaMkt("ads"),
      custoVariavel,
      custoFixo,
      perdasDescarte,
      lucroLiquido,
      margemBruta:   receitaLojaTotal > 0 ? (lucroBrutoTotal / receitaLojaTotal) * 100 : null,
      margemLiquida: receitaLojaTotal > 0 ? (lucroLiquido / receitaLojaTotal) * 100 : null,
      custoIncompleto: !custoInsumosKnown && receitaOrdens > 0 || marketplace.custoIncompleto || (receitaDtf > 0 && custoDtfUnitario === null),
    }

    // Lucro por canal = receita − deduções (imposto, taxas, cupom, frete) − custo das peças − ads.
    // Custo fixo, custo variável e perdas não são rateados: ficam só no total.
    const imp = (v: number) => v * aliquota / 100
    const LABEL: Record<string, string> = { pdv: "Balcão (PDV)", whatsapp: "WhatsApp", site: "Site", SHP_MARI: "Shopee MARI", SHP_SAMU: "Shopee SAMU", TKTK_SAMU: "TikTok SAMU", ML_MARI: "Mercado Livre MARI" }
    const canais: { canal: string; nome: string; receita: number; deducoes: number; custo: number | null; ads: number; lucro: number | null; margem: number | null }[] = []
    for (const ch of ["pdv", "whatsapp", "site"]) {
      const receita = byChannel[ch] ?? 0
      if (!receita) continue
      const custo = custoCanal[ch] ?? (custoInsumosKnown ? 0 : null)
      const lucro = custo == null ? null : receita - imp(receita) - custo
      canais.push({ canal: ch, nome: LABEL[ch], receita, deducoes: imp(receita), custo, ads: 0, lucro, margem: lucro != null && receita ? (lucro / receita) * 100 : null })
    }
    if (receitaDtf > 0) {
      const custo = custoDtfCaixa
      const lucro = custo == null ? null : receitaDtf - imp(receitaDtf) - custo
      canais.push({ canal: "dtf", nome: "DTF", receita: receitaDtf, deducoes: imp(receitaDtf), custo, ads: 0, lucro, margem: lucro != null ? (lucro / receitaDtf) * 100 : null })
    }
    if (receitaAvarias > 0) canais.push({ canal: "avarias", nome: "Avarias vendidas", receita: receitaAvarias, deducoes: imp(receitaAvarias), custo: 0, ads: 0, lucro: receitaAvarias - imp(receitaAvarias), margem: 100 - aliquota })
    for (const l of lojasMkt) {
      const ded = l.taxas + l.cupom + l.frete + imp(l.vendas)
      const lucro = l.vendas - ded - l.custo - l.ads
      canais.push({ canal: l.loja, nome: LABEL[l.loja] ?? l.loja, receita: l.vendas, deducoes: ded, custo: l.custo, ads: l.ads, lucro, margem: l.vendas ? (lucro / l.vendas) * 100 : null })
    }

    return NextResponse.json({
      period: { from, to, days },
      completo,
      canais,
      dre: {
        receitaBruta,
        receitaAvarias,
        custoInsumos:  custoInsumosKnown ? custoInsumos : null,
        lucroBruto,
        custoCostura,
        custoFixo,
        custoVariavel,
        perdasDescarte,
        despesasPagas,
        despesasPagasCount: Number(payablesRows[0]?.count ?? 0),
        resultadoOp,
      },
      summary: {
        pedidosTotal:      orders.length + dtfCount,
        pedidosConcluidos: concluded.length + dtfCount,
        totalPecas,
        ticketMedio,
        margemBruta: lucroBruto !== null && receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : null,
        margemOp:    resultadoOp !== null && receitaBruta > 0 ? (resultadoOp / receitaBruta) * 100 : null,
      },
      byChannel,
      marketplace,
      dtf: { receita: receitaDtf, count: dtfCount, metros: metrosDtf },
      productRanking,
      materialFlow: {
        entradas: { total: Number(matEntradas[0]?.total ?? 0), count: Number(matEntradas[0]?.count ?? 0) },
        saidas:   { total: Number(matSaidas[0]?.total  ?? 0), count: Number(matSaidas[0]?.count  ?? 0) },
      },
      diagnostico: {
        semCusto: semCustoRows.map(r => r.product_name as string),
        dtfSemCusto: metrosDtf > 0 && custoDtfUnitario === null,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
