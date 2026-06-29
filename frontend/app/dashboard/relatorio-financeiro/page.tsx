"use client"

import { useState, useCallback, useEffect } from "react"
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Package, ChevronDown, ChevronUp } from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"

// ─── Types ────────────────────────────────────────────────────────────────────

type DRE = {
  receitaBruta:   number
  custoInsumos:   number | null
  lucroBruto:     number | null
  custoCostura:   number
  custoFixo:      number
  custoVariavel:  number
  resultadoOp:    number | null
}

type Summary = {
  pedidosTotal:      number
  pedidosConcluidos: number
  totalPecas:        number
  ticketMedio:       number
  margemBruta:       number | null
  margemOp:          number | null
}

type ProductRow = {
  name:    string
  revenue: number
  cost:    number | null
  margin:  number | null
  qty:     number
}

type ReportData = {
  period:         { from: string; to: string; days: number }
  dre:            DRE
  summary:        Summary
  byChannel:      Record<string, number>
  productRanking: ProductRow[]
}

type StockItem = {
  productName: string; color: string; size: string
  qty: number; costPrice: number; salePrice: number
  totalCost: number; totalSale: number
}
type RawItem = {
  materialName: string; variantName: string; unit: string
  qty: number; unitPrice: number; totalCost: number
}
type StockValuation = {
  products:     { items: StockItem[]; totalCost: number; totalSale: number }
  rawMaterials: { items: RawItem[];   totalCost: number }
  grandTotalCost: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

type PresetKey = "mes_atual" | "mes_anterior" | "7d" | "30d" | "60d" | "range"

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "mes_atual",    label: "Mês atual"     },
  { key: "mes_anterior", label: "Mês anterior"  },
  { key: "7d",           label: "7 dias"        },
  { key: "30d",          label: "30 dias"       },
  { key: "60d",          label: "60 dias"       },
  { key: "range",        label: "Período"       },
]

const CHANNEL_LABEL: Record<string, string> = {
  pdv:      "PDV",
  whatsapp: "WhatsApp",
  manual:   "Manual",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtR(v: number | null, opts?: { signed?: boolean }) {
  if (v === null) return "—"
  const n    = Number(v)
  const abs  = Math.abs(n)
  const str  = `R$ ${abs.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  if (opts?.signed && n < 0) return `(${str})`
  return str
}

function pct(v: number | null) {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function getPresetDates(key: PresetKey, rs: string, re: string): [string, string] | null {
  const t = todayBR()
  const [y, m] = t.split("-").map(Number)
  switch (key) {
    case "mes_atual":    return [`${y}-${String(m).padStart(2, "0")}-01`, t]
    case "mes_anterior": {
      const pm = m === 1 ? 12 : m - 1
      const py = m === 1 ? y - 1 : y
      const lastDay = new Date(y, pm - 1, 0).getDate()
      return [`${py}-${String(pm).padStart(2, "0")}-01`, `${py}-${String(pm).padStart(2, "0")}-${lastDay}`]
    }
    case "7d":  return [subDaysBR(6), t]
    case "30d": return [subDaysBR(29), t]
    case "60d": return [subDaysBR(59), t]
    case "range": return (rs && re) ? [rs, re] : null
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string
  color?: "green" | "red" | "blue" | "amber"
  icon?: React.ElementType
}) {
  const colorCls = {
    green: "text-emerald-600",
    red:   "text-red-600",
    blue:  "text-[#4361EE]",
    amber: "text-amber-600",
  }[color ?? "blue"]
  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon size={14} className={`${colorCls} opacity-70`} />}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{label}</p>
      </div>
      <p className={`text-2xl font-black mt-1 leading-none ${colorCls}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#0F1E3C]/35 mt-1">{sub}</p>}
    </div>
  )
}

function DRERow({ label, value, indent, negative, bold, separator, sub }: {
  label?: string; value?: number | null; indent?: boolean; negative?: boolean
  bold?: boolean; separator?: boolean; sub?: string
}) {
  if (separator) {
    return <div className="border-t border-[#0F1E3C]/8 my-1" />
  }
  const isNeg    = negative || (value !== null && value !== undefined && value < 0)
  const display  = fmtR(value ?? null, { signed: true })
  return (
    <div className={`flex items-center justify-between py-2 ${bold ? "font-bold" : ""}`}>
      <div className={`flex items-start gap-1 ${indent ? "pl-4" : ""}`}>
        {indent && <span className="text-[#0F1E3C]/25 text-xs mt-0.5">↳</span>}
        <div>
          <span className={`text-sm ${bold ? "text-[#0F1E3C]" : "text-[#0F1E3C]/70"}`}>{label}</span>
          {sub && <p className="text-[10px] text-[#0F1E3C]/35">{sub}</p>}
        </div>
      </div>
      <span className={`text-sm font-bold tabular-nums ${
        value === null || value === undefined ? "text-[#0F1E3C]/25"
        : isNeg ? "text-red-600"
        : bold  ? "text-[#0F1E3C]"
        : "text-[#0F1E3C]/70"
      }`}>
        {display}
      </span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RelatorioFinanceiroPage() {
  const [preset,     setPreset]     = useState<PresetKey>("mes_atual")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd,   setRangeEnd]   = useState("")
  const [data,       setData]       = useState<ReportData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")
  const [dreOpen,    setDreOpen]    = useState(true)
  const [stockVal,   setStockVal]   = useState<StockValuation | null>(null)
  const [stockOpen,  setStockOpen]  = useState(true)

  const load = useCallback(async () => {
    const dates = getPresetDates(preset, rangeStart, rangeEnd)
    if (!dates) return
    setLoading(true)
    setError("")
    try {
      const [dreRes, valRes] = await Promise.all([
        fetch(`/api/relatorio-financeiro?from=${dates[0]}&to=${dates[1]}`),
        fetch("/api/stock-valuation"),
      ])
      if (!dreRes.ok) { const d = await dreRes.json(); throw new Error(d.error); }
      setData(await dreRes.json())
      if (valRes.ok) setStockVal(await valRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    } finally {
      setLoading(false)
    }
  }, [preset, rangeStart, rangeEnd])

  useEffect(() => { load() }, [load])

  const dre     = data?.dre
  const summary = data?.summary
  const channelTotal = Object.values(data?.byChannel ?? {}).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Relatório Financeiro
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">DRE · Receita · Margens · Ranking de produtos</p>
        </div>
        <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors border border-[#0F1E3C]/8">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8 w-fit">
          {PRESETS.map(({ key, label }) => (
            <button key={key} onClick={() => setPreset(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                preset === key
                  ? "bg-[#4361EE] text-white shadow-sm"
                  : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"
              }`}>
              {label}
            </button>
          ))}
        </div>
        {preset === "range" && (
          <div className="flex items-center gap-2">
            <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
            <span className="text-xs text-[#0F1E3C]/40">até</span>
            <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="Receita Confirmada"
              value={fmtR(dre?.receitaBruta ?? 0)}
              sub={`${summary?.pedidosConcluidos ?? 0} pedidos concluídos`}
              icon={DollarSign}
              color="blue"
            />
            <KPICard
              label="Resultado s/ Insumos"
              value={fmtR(dre?.lucroBruto ?? null)}
              sub={dre?.lucroBruto != null ? `margem ${pct(summary?.margemBruta ?? null)}` : "Sem custo cadastrado"}
              icon={TrendingUp}
              color={dre?.lucroBruto != null && dre.lucroBruto >= 0 ? "green" : "red"}
            />
            <KPICard
              label="Resultado Operacional"
              value={fmtR(dre?.resultadoOp ?? null)}
              sub={dre?.resultadoOp != null ? `margem op. ${pct(summary?.margemOp ?? null)}` : "Sem custo cadastrado"}
              icon={dre?.resultadoOp != null && (dre.resultadoOp ?? 0) >= 0 ? TrendingUp : TrendingDown}
              color={dre?.resultadoOp != null && (dre.resultadoOp ?? 0) >= 0 ? "green" : "red"}
            />
            <KPICard
              label="Peças / Ticket Médio"
              value={`${summary?.totalPecas ?? 0} pç`}
              sub={`Ticket ${fmtR(summary?.ticketMedio ?? 0)}`}
              icon={Package}
              color="amber"
            />
          </div>

          {/* DRE Collapsible */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <button
              onClick={() => setDreOpen(v => !v)}
              className="w-full flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/6 hover:bg-[#F4F6FB] transition-colors"
            >
              <div>
                <p className="text-sm font-bold text-[#0F1E3C] text-left">Demonstrativo de Resultado (DRE)</p>
                <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5 text-left">
                  {data.period.days} dias · {data.period.from} → {data.period.to}
                </p>
              </div>
              {dreOpen ? <ChevronUp size={16} className="text-[#0F1E3C]/30" /> : <ChevronDown size={16} className="text-[#0F1E3C]/30" />}
            </button>
            {dreOpen && (
              <div className="px-6 py-4">
                <DRERow bold label="(+) Receita Bruta" value={dre?.receitaBruta} />
                <DRERow label="(-) Custo de Insumos" value={dre?.custoInsumos != null ? -(dre.custoInsumos) : null}
                  indent negative sub="material_cost dos produtos vendidos" />
                <DRERow separator />
                <DRERow bold label="Resultado s/ Insumos (Lucro Bruto)" value={dre?.lucroBruto} />
                <DRERow label="(-) Custo de Costura" value={-(dre?.custoCostura ?? 0)} indent negative
                  sub={`${data.period.days}d de custo operacional`} />
                <DRERow label="(-) Custo Fixo" value={-(dre?.custoFixo ?? 0)} indent negative />
                <DRERow label="(-) Custo Variável" value={-(dre?.custoVariavel ?? 0)} indent negative
                  sub="despesas variáveis lançadas no período" />
                <DRERow separator />
                <DRERow bold label="Resultado Operacional" value={dre?.resultadoOp} />
              </div>
            )}
          </div>

          {/* Stock valuation */}
          {stockVal && (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <button
                onClick={() => setStockOpen(v => !v)}
                className="w-full flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/6 hover:bg-[#F4F6FB] transition-colors"
              >
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C] text-left">Balanço de Estoque — Snapshot Atual</p>
                  <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5 text-left">Capital imobilizado em produto pronto e insumos</p>
                </div>
                {stockOpen ? <ChevronUp size={16} className="text-[#0F1E3C]/30" /> : <ChevronDown size={16} className="text-[#0F1E3C]/30" />}
              </button>
              {stockOpen && (
                <div className="p-6 space-y-6">
                  {/* KPI cards do estoque */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KPICard
                      label="Capital em Produtos (custo)"
                      value={fmtR(stockVal.products.totalCost)}
                      sub={`${stockVal.products.items.length} variações em estoque`}
                      icon={Package} color="blue"
                    />
                    <KPICard
                      label="Capital em Insumos"
                      value={fmtR(stockVal.rawMaterials.totalCost)}
                      sub={`${stockVal.rawMaterials.items.length} lotes disponíveis`}
                      icon={Package}
                    />
                    <KPICard
                      label="Receita Potencial (venda)"
                      value={fmtR(stockVal.products.totalSale)}
                      sub={
                        stockVal.products.totalCost > 0
                          ? `margem potencial ${(((stockVal.products.totalSale - stockVal.products.totalCost) / stockVal.products.totalSale) * 100).toFixed(1)}%`
                          : undefined
                      }
                      icon={TrendingUp} color="green"
                    />
                  </div>

                  {/* Tabela de produtos em estoque */}
                  {stockVal.products.items.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-3">Produtos em estoque</p>
                      <div className="overflow-x-auto rounded-xl border border-[#0F1E3C]/6">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                              {["Produto", "Cor", "Tam", "Qtd", "Custo/un", "Preço/un", "Total custo", "Total venda"].map(h => (
                                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#0F1E3C]/4">
                            {stockVal.products.items.map((r, i) => (
                              <tr key={i} className="hover:bg-[#F4F6FB] transition-colors">
                                <td className="px-4 py-2.5 font-semibold text-[#0F1E3C] max-w-[140px] truncate">{r.productName}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{r.color || "—"}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{r.size  || "—"}</td>
                                <td className="px-4 py-2.5 font-bold text-[#0F1E3C]">{r.qty}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{r.costPrice > 0 ? fmtR(r.costPrice) : "—"}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{r.salePrice > 0 ? fmtR(r.salePrice) : "—"}</td>
                                <td className="px-4 py-2.5 font-bold text-[#4361EE]">{r.costPrice > 0 ? fmtR(r.totalCost) : "—"}</td>
                                <td className="px-4 py-2.5 font-bold text-emerald-600">{r.salePrice > 0 ? fmtR(r.totalSale) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[#0F1E3C]/8 bg-[#F4F6FB]">
                              <td colSpan={6} className="px-4 py-2.5 text-xs font-bold text-[#0F1E3C]/40 uppercase">Total</td>
                              <td className="px-4 py-2.5 font-black text-[#4361EE]">{fmtR(stockVal.products.totalCost)}</td>
                              <td className="px-4 py-2.5 font-black text-emerald-600">{fmtR(stockVal.products.totalSale)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Insumos */}
                  {stockVal.rawMaterials.items.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-3">Insumos disponíveis</p>
                      <div className="overflow-x-auto rounded-xl border border-[#0F1E3C]/6">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                              {["Insumo", "Variante", "Qtd", "Unidade", "Custo unit.", "Total"].map(h => (
                                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#0F1E3C]/4">
                            {stockVal.rawMaterials.items.map((r, i) => (
                              <tr key={i} className="hover:bg-[#F4F6FB] transition-colors">
                                <td className="px-4 py-2.5 font-semibold text-[#0F1E3C]">{r.materialName}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{r.variantName || "—"}</td>
                                <td className="px-4 py-2.5 font-bold text-[#0F1E3C]">{r.qty}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/40">{r.unit}</td>
                                <td className="px-4 py-2.5 text-[#0F1E3C]/50">{fmtR(r.unitPrice)}</td>
                                <td className="px-4 py-2.5 font-bold text-[#4361EE]">{fmtR(r.totalCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[#0F1E3C]/8 bg-[#F4F6FB]">
                              <td colSpan={5} className="px-4 py-2.5 text-xs font-bold text-[#0F1E3C]/40 uppercase">Total insumos</td>
                              <td className="px-4 py-2.5 font-black text-[#4361EE]">{fmtR(stockVal.rawMaterials.totalCost)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Revenue by channel + Product ranking */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* By channel */}
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
                <p className="text-sm font-bold text-[#0F1E3C]">Receita por canal</p>
                <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">pedidos concluídos</p>
              </div>
              <div className="p-5 space-y-4">
                {Object.entries(data.byChannel).sort(([, a], [, b]) => b - a).map(([ch, val]) => {
                  const share = channelTotal > 0 ? (val / channelTotal) * 100 : 0
                  return (
                    <div key={ch}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-[#0F1E3C]">{CHANNEL_LABEL[ch] ?? ch}</span>
                        <div className="text-right">
                          <span className="text-sm font-bold text-[#0F1E3C]">{fmtR(val)}</span>
                          <span className="text-[10px] text-[#0F1E3C]/35 ml-1.5">{share.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-[#0F1E3C]/6 rounded-full overflow-hidden">
                        <div className="h-full bg-[#4361EE] rounded-full transition-all" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  )
                })}
                {Object.keys(data.byChannel).length === 0 && (
                  <p className="text-sm text-center text-[#0F1E3C]/30 py-4">Sem vendas no período</p>
                )}
              </div>
            </div>

            {/* Product ranking */}
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
                <p className="text-sm font-bold text-[#0F1E3C]">Ranking de produtos</p>
                <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">por receita · pedidos concluídos</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                      {["#", "Produto", "Qtd", "Receita", "Margem"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0F1E3C]/4">
                    {data.productRanking.slice(0, 12).map((p, i) => (
                      <tr key={p.name} className="hover:bg-[#F4F6FB] transition-colors">
                        <td className="px-4 py-3 text-[10px] font-bold text-[#0F1E3C]/30">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold text-[#0F1E3C] max-w-[160px] truncate">{p.name}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50">{p.qty}</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C]">{fmtR(p.revenue)}</td>
                        <td className="px-4 py-3">
                          {p.margin !== null ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              p.margin >= 40 ? "bg-emerald-100 text-emerald-700"
                              : p.margin >= 20 ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                            }`}>
                              {p.margin.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#0F1E3C]/25">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {data.productRanking.length === 0 && (
                      <tr><td colSpan={5} className="py-10 text-center text-sm text-[#0F1E3C]/25">Sem dados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
