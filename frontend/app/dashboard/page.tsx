"use client"

import { useState, useEffect, useCallback } from "react"
import MetricCard from "@/components/cards/MetricCard"
import { calcInventoryMetrics, calcMonthlyOperationalCost, formatCurrency, type BalanceRow } from "@/lib/calculations"
import type { OperationalCost, InventoryMetric } from "@/lib/types"
import { Factory, Package, Receipt, DollarSign, AlertCircle, Clock, TrendingUp, ShoppingBag, Printer, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { todayBR, subDaysBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

type PendingOrder = { id: number; totalValue: number | null; dueDate: string | null }

// ─── Types ─────────────────────────────────────────────────────────────────────
type PeriodKey = "hoje" | "ontem" | "7d" | "15d" | "30d" | "60d" | "range"

type ProdProduct = {
  productId: string; productName: string
  orderCount: number; totalPieces: number
  materialCost: number; operationalCost: number
  totalCost: number; costPerPiece: number
  avgSalePrice: number; margin: number | null
}
type ProdData = {
  period: { start: string; end: string; days: number }
  summary: { orderCount: number; totalPieces: number; materialCost: number; operationalCost: number; totalCost: number }
  byProduct: ProdProduct[]
}

type FinanceiroData = {
  dre: {
    receitaBruta: number; resultadoOp: number | null
  }
  summary: {
    pedidosConcluidos: number; ticketMedio: number
    margemOp: number | null
  }
  byChannel: Record<string, number>
  dtf: { receita: number; count: number; metros: number }
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "hoje",  label: "Hoje"    },
  { key: "ontem", label: "Ontem"   },
  { key: "7d",    label: "7d"      },
  { key: "15d",   label: "15d"     },
  { key: "30d",   label: "30d"     },
  { key: "60d",   label: "60d"     },
  { key: "range", label: "Período" },
]

function getPeriodDates(key: PeriodKey, rs: string, re: string): [string, string] {
  const t = todayBR()
  switch (key) {
    case "hoje":  return [t, t]
    case "ontem": { const d = subDaysBR(1); return [d, d] }
    case "7d":    return [subDaysBR(6),  t]
    case "15d":   return [subDaysBR(14), t]
    case "30d":   return [subDaysBR(29), t]
    case "60d":   return [subDaysBR(59), t]
    case "range": return [rs, re]
  }
}

function periodLabel(key: PeriodKey, rs: string, re: string): string {
  if (key !== "range") return PERIOD_OPTIONS.find(p => p.key === key)?.label ?? ""
  if (!rs || !re) return "Período"
  const fmt = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}` }
  return `${fmt(rs)} – ${fmt(re)}`
}

const STATUS_LABEL: Record<string, string> = {
  urgent: "Urgente", attention: "Atenção", healthy: "Saudável", excess: "Excesso", stopped: "Parado",
}
const STATUS_CLASS: Record<string, string> = {
  urgent:    "bg-red-100 text-red-700",
  attention: "bg-amber-100 text-amber-700",
  healthy:   "bg-emerald-100 text-emerald-700",
  excess:    "bg-gray-100 text-gray-600",
  stopped:   "bg-purple-100 text-purple-700",
}

const CHANNEL_LABEL: Record<string, string> = {
  pdv: "Balcão (PDV)", whatsapp: "WhatsApp", manual: "Manual", dtf: "DTF",
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  // Period filter
  const [period,     setPeriod]     = useState<PeriodKey>("hoje")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd,   setRangeEnd]   = useState("")

  // Production data (period-sensitive)
  const [prodData,    setProdData]    = useState<ProdData | null>(null)
  const [prodLoading, setProdLoading] = useState(true)

  // Financeiro + Vendas data (period-sensitive, same DRE endpoint)
  const [financeiro,        setFinanceiro]        = useState<FinanceiroData | null>(null)
  const [financeiroLoading, setFinanceiroLoading] = useState(true)

  // Stock data (always current)
  const [balance,      setBalance]      = useState<BalanceRow[]>([])
  const [costs,        setCosts]        = useState<OperationalCost[]>([])
  const [metrics,      setMetrics]      = useState<InventoryMetric[]>([])
  const [stockLoading, setStockLoading] = useState(true)

  // Receivables summary
  const [receivables, setReceivables] = useState<PendingOrder[]>([])

  // Raw material valuation
  const [rawMatCost, setRawMatCost] = useState<number | null>(null)

  // Avarias pendentes (always current)
  const [avariasPendentes, setAvariasPendentes] = useState<{ count: number; qty: number }>({ count: 0, qty: 0 })

  // Load stock + receivables + raw material valuation + avarias once on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/stock/balance").then(r => r.json()),
      fetch("/api/operational-costs").then(r => r.json()),
      fetch("/api/clientes-a-receber").then(r => r.json()),
      fetch("/api/stock-valuation").then(r => r.ok ? r.json() : null),
      fetch("/api/defect-stock?disposition=pendente").then(r => r.ok ? r.json() : []),
    ]).then(([bal, c, rec, val, avarias]) => {
      const b: BalanceRow[] = Array.isArray(bal) ? bal : []
      const cs: OperationalCost[] = Array.isArray(c) ? c : []
      setBalance(b)
      setCosts(cs)
      setMetrics(calcInventoryMetrics(b, calcMonthlyOperationalCost(cs)))
      setReceivables(Array.isArray(rec) ? rec : [])
      if (val?.rawMaterials?.totalCost != null) setRawMatCost(val.rawMaterials.totalCost)
      const avariaRows: { qty: number }[] = Array.isArray(avarias) ? avarias : []
      setAvariasPendentes({
        count: avariaRows.length,
        qty: avariaRows.reduce((s, a) => s + Number(a.qty ?? 0), 0),
      })
    }).finally(() => setStockLoading(false))
  }, [])

  // Load production + financeiro when period changes
  const loadPeriodData = useCallback(async () => {
    const [start, end] = getPeriodDates(period, rangeStart, rangeEnd)
    if (period === "range" && (!rangeStart || !rangeEnd)) return
    setProdLoading(true)
    setFinanceiroLoading(true)
    try {
      const [prodRes, finRes] = await Promise.all([
        fetch(`/api/dashboard/production?start=${start}&end=${end}`),
        fetch(`/api/relatorio-financeiro?from=${start}&to=${end}`),
      ])
      if (prodRes.ok) setProdData(await prodRes.json())
      if (finRes.ok) setFinanceiro(await finRes.json())
    } finally {
      setProdLoading(false)
      setFinanceiroLoading(false)
    }
  }, [period, rangeStart, rangeEnd])

  useEffect(() => { loadPeriodData() }, [loadPeriodData])

  // Derived stock valuation (from existing balance)
  const capitalProdutos  = balance.reduce((s, r) => s + r.currentStock * (Number(r.costPrice) || 0), 0)
  const receitaPotencial = balance.reduce((s, r) => s + r.currentStock * (Number(r.salePrice) || 0), 0)

  // Derived receivables
  const today           = todayBR()
  const recTotal        = receivables.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
  const recOverdueTotal = receivables.filter(o => o.dueDate && o.dueDate < today).reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
  const recOverdueCount = receivables.filter(o => o.dueDate && o.dueDate < today).length
  const recTodayTotal   = receivables.filter(o => o.dueDate === today).reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
  const recTodayCount   = receivables.filter(o => o.dueDate === today).length

  // Derived stock values
  const opCost     = calcMonthlyOperationalCost(costs)
  const totalStock = balance.reduce((a, v) => a + v.currentStock, 0)
  const critical   = metrics.filter(m => m.status === "urgent" || m.status === "attention")
  const stopped    = metrics.filter(m => m.status === "stopped")
  const toProduced = metrics.filter(m => m.suggestedProduction > 0).slice(0, 6)

  const pLabel = periodLabel(period, rangeStart, rangeEnd)

  return (
    <div className="space-y-8">

      {/* ── Header + Filtro global ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Dashboard
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Visão geral da SM Confecções</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.key}
                onClick={() => setPeriod(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  period === opt.key
                    ? "bg-[#4361EE] text-white shadow-sm"
                    : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {period === "range" && (
            <div className="flex items-center gap-2">
              <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              <span className="text-xs text-[#0F1E3C]/40">até</span>
              <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
            </div>
          )}
        </div>
      </div>

      {/* ── FINANCEIRO ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign size={14} className="text-[#4361EE]"/>
            <h2 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">
              Financeiro — {pLabel}
            </h2>
          </div>
          <Link href="/dashboard/relatorio-financeiro" className="text-xs font-semibold text-[#4361EE] hover:underline">
            Relatório completo →
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {financeiroLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse"/>
              ))
            : [
                { title: "Receita bruta",        value: fmtR(financeiro?.dre.receitaBruta ?? 0), color: "blue" as const },
                {
                  title: "Resultado",
                  value: financeiro?.dre.resultadoOp !== null && financeiro?.dre.resultadoOp !== undefined
                    ? fmtR(financeiro.dre.resultadoOp) : "—",
                  color: (financeiro?.dre.resultadoOp ?? 0) >= 0 ? "green" as const : "red" as const,
                },
                {
                  title: "Margem operacional",
                  value: financeiro?.summary.margemOp != null ? `${financeiro.summary.margemOp.toFixed(1)}%` : "—",
                  color: "default" as const,
                },
                { title: "Ticket médio", value: fmtR(financeiro?.summary.ticketMedio ?? 0), color: "default" as const },
              ].map(({ title, value, color }) => (
                <MetricCard key={title} title={title} value={value} color={color}/>
              ))
          }
        </div>

        {/* Recebimentos pendentes — sempre "hoje", não segue o filtro de período */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[#0F1E3C]/35 uppercase tracking-wider">Recebimentos pendentes — sempre atual</p>
            <Link href="/dashboard/clientes-a-receber" className="text-xs font-semibold text-[#4361EE] hover:underline">
              Ver todos →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
                <Receipt size={16} className="text-[#4361EE]" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Total a Receber</p>
                <p className="text-2xl font-black text-[#0F1E3C] mt-0.5 leading-none">
                  {`R$ ${recTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                </p>
                <p className="text-[10px] text-[#0F1E3C]/40 mt-0.5">{receivables.length} cobranças pendentes</p>
              </div>
            </div>
            <div className={`bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-3 ${recOverdueCount > 0 ? "border-red-200 bg-red-50/30" : "border-[#0F1E3C]/8"}`}>
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={16} className="text-red-500" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Vencidos</p>
                <p className="text-2xl font-black text-red-600 mt-0.5 leading-none">
                  {`R$ ${recOverdueTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                </p>
                <p className="text-[10px] text-red-400 mt-0.5">{recOverdueCount} {recOverdueCount === 1 ? "cobrança" : "cobranças"}</p>
              </div>
            </div>
            <div className={`bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-3 ${recTodayCount > 0 ? "border-amber-200 bg-amber-50/30" : "border-[#0F1E3C]/8"}`}>
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Clock size={16} className="text-amber-500" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Vencem Hoje</p>
                <p className="text-2xl font-black text-amber-600 mt-0.5 leading-none">
                  {`R$ ${recTodayTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                </p>
                <p className="text-[10px] text-amber-500 mt-0.5">{recTodayCount} {recTodayCount === 1 ? "cobrança" : "cobranças"}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VENDAS ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShoppingBag size={14} className="text-[#4361EE]"/>
          <h2 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">
            Vendas — {pLabel}
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {financeiroLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse"/>
              ))
            : (["pdv", "whatsapp", "manual"] as const).map(ch => (
                <MetricCard
                  key={ch}
                  title={CHANNEL_LABEL[ch]}
                  value={fmtR(financeiro?.byChannel[ch] ?? 0)}
                  color="blue"
                />
              ))
          }
          {/* DTF — card resumido com atalho pro dashboard DTF */}
          {financeiroLoading ? (
            <div className="h-[72px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse"/>
          ) : (
            <Link href="/dashboard/dtf/pedidos" className="block">
              <div className="rounded-2xl border border-[#4361EE]/20 bg-white p-5 shadow-sm hover:shadow-md transition-shadow h-full">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40 flex items-center gap-1.5">
                    <Printer size={12} className="text-[#4361EE]"/> DTF
                  </p>
                </div>
                <p className="text-2xl font-black text-[#4361EE]">{fmtR(financeiro?.dtf.receita ?? 0)}</p>
                <p className="text-xs text-[#0F1E3C]/35 mt-1.5">
                  {financeiro?.dtf.count ?? 0} pedido{(financeiro?.dtf.count ?? 0) !== 1 ? "s" : ""} · {(financeiro?.dtf.metros ?? 0).toFixed(1)} m
                </p>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* ── PRODUÇÃO ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Factory size={14} className="text-[#4361EE]"/>
          <h2 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">
            Produção — {pLabel}
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {prodLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse"/>
              ))
            : [
                { title: "Ordens",            value: String(prodData?.summary.orderCount ?? 0) },
                { title: "Peças produzidas",  value: `${prodData?.summary.totalPieces ?? 0} pç` },
                { title: "Custo material",    value: fmtR(prodData?.summary.materialCost    ?? 0) },
                { title: "Custo operacional", value: fmtR(prodData?.summary.operationalCost ?? 0) },
                { title: "Custo total",       value: fmtR(prodData?.summary.totalCost       ?? 0) },
              ].map(({ title, value }) => (
                <MetricCard key={title} title={title} value={value} color="blue"/>
              ))
          }
        </div>
      </section>

      {/* ── CUSTOS DE PRODUTO ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-[#0F1E3C]/35"/>
          <h2 className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">
            Custos de Produto — {pLabel}
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <p className="text-sm font-bold text-[#0F1E3C]">Custo por produto</p>
          </div>

          {prodLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : !prodData?.byProduct.length ? (
            <p className="py-12 text-center text-sm text-[#0F1E3C]/30">
              Nenhuma ordem concluída neste período
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#0F1E3C]/8 bg-[#F9FAFB]">
                    {["Produto","Ordens","Peças","Custo Mat.","Custo Op.","Custo Total","Custo/peça","Preço médio","Margem"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prodData.byProduct.map((p, i) => (
                    <tr key={p.productId}
                      className={`border-b border-[#0F1E3C]/4 last:border-0 ${i % 2 === 1 ? "bg-[#F9FAFB]/50" : ""}`}>
                      <td className="px-4 py-3.5 font-semibold text-[#0F1E3C]">{p.productName}</td>
                      <td className="px-4 py-3.5 text-[#0F1E3C]/50">{p.orderCount}</td>
                      <td className="px-4 py-3.5 font-bold text-[#0F1E3C]">{p.totalPieces}</td>
                      <td className="px-4 py-3.5 text-[#0F1E3C]/60">{fmtR(p.materialCost)}</td>
                      <td className="px-4 py-3.5 text-[#0F1E3C]/60">{fmtR(p.operationalCost)}</td>
                      <td className="px-4 py-3.5 font-bold text-[#4361EE]">{fmtR(p.totalCost)}</td>
                      <td className="px-4 py-3.5 font-bold text-[#0F1E3C]">{fmtR(p.costPerPiece)}</td>
                      <td className="px-4 py-3.5 text-[#0F1E3C]/60">
                        {p.avgSalePrice > 0 ? fmtR(p.avgSalePrice) : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        {p.margin !== null ? (
                          <span className={`text-sm font-bold ${
                            p.margin >= 40 ? "text-emerald-600"
                            : p.margin >= 20 ? "text-amber-600"
                            : "text-red-600"
                          }`}>
                            {p.margin.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── ESTOQUE (sempre atual) ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Package size={14} className="text-[#0F1E3C]/35"/>
          <h2 className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Estoque — Hoje (não segue o filtro de período)</h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          <MetricCard title="Total em estoque"     value={`${totalStock} peças`} />
          <MetricCard title="Custo op./mês"        value={formatCurrency(opCost)} color="blue" />
          <MetricCard title="Capital em produtos"  value={formatCurrency(capitalProdutos)} color="blue" />
          <MetricCard title="Capital em insumos"   value={rawMatCost !== null ? formatCurrency(rawMatCost) : "—"} />
          <MetricCard title="Receita potencial"    value={formatCurrency(receitaPotencial)} color="yellow" />
          <MetricCard title="Variações críticas"   value={critical.length} color={critical.length > 0 ? "red" : "default"} />
          <Link href="/dashboard/estoque-avarias" className="block">
            <div className={`rounded-2xl border p-5 shadow-sm h-full hover:shadow-md transition-shadow ${
              avariasPendentes.count > 0 ? "border-amber-200 bg-amber-50/30" : "bg-white border-[#0F1E3C]/8"
            }`}>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} className={avariasPendentes.count > 0 ? "text-amber-500" : "text-[#0F1E3C]/30"}/> Avarias pendentes
              </p>
              <p className={`text-2xl font-black ${avariasPendentes.count > 0 ? "text-amber-600" : "text-[#0F1E3C]"}`}>
                {avariasPendentes.count}
              </p>
              <p className="text-xs text-[#0F1E3C]/35 mt-1.5">{avariasPendentes.qty} peça{avariasPendentes.qty !== 1 ? "s" : ""} aguardando destino</p>
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Estoque crítico */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Estoque crítico</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#0F1E3C]/5">
                  {["Variação","Estoque","Dias rest.","Status"].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0F1E3C]/4">
                {stockLoading ? (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-[#0F1E3C]/25">Carregando...</td></tr>
                ) : critical.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-[#0F1E3C]/25">Nenhuma variação crítica</td></tr>
                ) : critical.map(m => (
                  <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                    <td className="px-5 py-3 font-medium text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                    <td className="px-5 py-3 text-[#0F1E3C]/65">{m.currentStock}</td>
                    <td className="px-5 py-3 text-[#0F1E3C]/65">{m.stockDaysRemaining?.toFixed(0) ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[m.status]}`}>
                        {STATUS_LABEL[m.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sugestão de produção */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Sugestão de produção</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#0F1E3C]/5">
                  {["Variação","Produzir","Lucro/un."].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0F1E3C]/4">
                {stockLoading ? (
                  <tr><td colSpan={3} className="py-8 text-center text-sm text-[#0F1E3C]/25">Carregando...</td></tr>
                ) : toProduced.length === 0 ? (
                  <tr><td colSpan={3} className="py-8 text-center text-sm text-[#0F1E3C]/25">Estoque adequado</td></tr>
                ) : toProduced.map(m => (
                  <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                    <td className="px-5 py-3 font-medium text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                    <td className="px-5 py-3 font-bold text-[#4361EE]">+{m.suggestedProduction}</td>
                    <td className="px-5 py-3 text-emerald-600 font-semibold">{formatCurrency(m.unitProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  )
}
