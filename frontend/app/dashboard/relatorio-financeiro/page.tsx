"use client"

import { useState, useCallback, useEffect } from "react"
import {
  RefreshCw, TrendingUp, Package,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Layers,
} from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"

// ─── Types ────────────────────────────────────────────────────────────────────

type DRE = {
  receitaBruta:   number
  receitaAvarias: number
  custoInsumos:   number | null
  lucroBruto:     number | null
  custoCostura:   number
  custoFixo:      number
  custoVariavel:  number
  perdasDescarte: number
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

type MaterialFlow = {
  entradas: { total: number; count: number }
  saidas:   { total: number; count: number }
}

type ReportData = {
  period:         { from: string; to: string; days: number }
  dre:            DRE
  summary:        Summary
  byChannel:      Record<string, number>
  productRanking: ProductRow[]
  materialFlow:   MaterialFlow
  diagnostico:    { semCusto: string[] }
}

type StockItem = {
  productName: string
  qty:         number
  costPrice:   number
  salePrice:   number
  totalCost:   number
  totalSale:   number
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
  { key: "mes_atual",    label: "Mês atual"    },
  { key: "mes_anterior", label: "Mês anterior" },
  { key: "7d",           label: "7 dias"       },
  { key: "30d",          label: "30 dias"      },
  { key: "60d",          label: "60 dias"      },
  { key: "range",        label: "Período"      },
]

const CHANNEL_LABEL: Record<string, string> = {
  pdv:      "PDV",
  whatsapp: "WhatsApp",
  manual:   "Manual",
}

const CHANNEL_COLOR: Record<string, string> = {
  pdv:      "#4361EE",
  whatsapp: "#10B981",
  manual:   "#F59E0B",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtRDRE(v: number | null) {
  if (v === null) return "—"
  const n   = Number(v)
  const abs = Math.abs(n)
  const str = `R$ ${abs.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  return n < 0 ? `(${str})` : str
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
    case "7d":    return [subDaysBR(6),  t]
    case "30d":   return [subDaysBR(29), t]
    case "60d":   return [subDaysBR(59), t]
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
  if (separator) return <div className="border-t border-[#0F1E3C]/8 my-1" />
  const isNeg   = negative || (value !== null && value !== undefined && value < 0)
  const display = fmtRDRE(value ?? null)
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
        : isNeg  ? "text-red-600"
        : bold   ? "text-[#0F1E3C]"
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
  const [dreOpen,    setDreOpen]    = useState(false)
  const [stockOpen,  setStockOpen]  = useState(true)
  const [stockVal,   setStockVal]   = useState<StockValuation | null>(null)

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
      if (!dreRes.ok) { const d = await dreRes.json(); throw new Error(d.error) }
      setData(await dreRes.json())
      if (valRes.ok) setStockVal(await valRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    } finally {
      setLoading(false)
    }
  }, [preset, rangeStart, rangeEnd])

  useEffect(() => { load() }, [load])

  const dre          = data?.dre
  const summary      = data?.summary
  const channelTotal = Object.values(data?.byChannel ?? {}).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Relatório Financeiro
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Receita · Insumos · Margens · Ranking</p>
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

          {/* Diagnóstico: produtos sem custo cadastrado */}
          {data.diagnostico.semCusto.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs font-bold text-amber-700 mb-1">
                Lucro e margem indisponíveis — {data.diagnostico.semCusto.length} produto(s) sem custo cadastrado:
              </p>
              <p className="text-xs text-amber-600">
                {data.diagnostico.semCusto.join(" · ")}
              </p>
              <p className="text-[10px] text-amber-500 mt-1">
                Acesse Produtos, abra cada um e salve o campo "Preço de custo".
              </p>
            </div>
          )}

          {/* ── 1. Receita por Canal — TOPO ─────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Receita por Canal</p>
              <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">
                pedidos concluídos · {data.period.from} → {data.period.to}
              </p>
            </div>
            <div className="p-6">
              {Object.keys(data.byChannel).length === 0 ? (
                <p className="text-sm text-center text-[#0F1E3C]/30 py-4">Sem vendas concluídas no período</p>
              ) : (
                <>
                  {/* Canal cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    {(["pdv", "whatsapp", "manual"] as const).map(ch => {
                      const val   = data.byChannel[ch] ?? 0
                      const share = channelTotal > 0 ? (val / channelTotal) * 100 : 0
                      const color = CHANNEL_COLOR[ch]
                      return (
                        <div key={ch} className="rounded-xl border border-[#0F1E3C]/6 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">
                            {CHANNEL_LABEL[ch]}
                          </p>
                          <p className="text-2xl font-black leading-none" style={{ color }}>
                            {val > 0 ? fmtRDRE(val) : "—"}
                          </p>
                          <div className="mt-3 h-1.5 bg-[#0F1E3C]/6 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${share}%`, backgroundColor: color }}
                            />
                          </div>
                          <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5 font-semibold">
                            {share > 0 ? `${share.toFixed(1)}%` : "0%"} do total
                          </p>
                        </div>
                      )
                    })}
                  </div>
                  {/* Total */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#0F1E3C]/6">
                    <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">
                      Total · {summary?.pedidosConcluidos ?? 0} pedidos concluídos
                    </span>
                    <span className="text-lg font-black text-[#0F1E3C]">{fmtRDRE(channelTotal)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── 2. Resumo de Vendas ─────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Resumo de Vendas</p>
              <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">
                {data.period.from} → {data.period.to} · {data.period.days} dias
              </p>
            </div>
            <div className="p-6 grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">

              {/* Vendas */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Vendas</p>
                <p className="text-3xl font-black text-[#0F1E3C] leading-none">
                  {summary?.pedidosConcluidos ?? 0}
                </p>
                <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">
                  pedidos concluídos
                  {(summary?.pedidosTotal ?? 0) > (summary?.pedidosConcluidos ?? 0) && (
                    <span className="ml-1 text-amber-500 font-semibold">
                      · {(summary?.pedidosTotal ?? 0) - (summary?.pedidosConcluidos ?? 0)} em andamento
                    </span>
                  )}
                </p>
              </div>

              {/* Faturamento */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Faturamento</p>
                <p className="text-3xl font-black text-[#4361EE] leading-none">
                  {fmtRDRE(dre?.receitaBruta ?? 0)}
                </p>
                <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">
                  {summary?.totalPecas ?? 0} peças · ticket {fmtRDRE(summary?.ticketMedio ?? 0)}
                </p>
              </div>

              {/* Lucro */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Lucro</p>
                {dre?.resultadoOp != null ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${dre.resultadoOp >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtRDRE(dre.resultadoOp)}
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">resultado operacional</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>
                    <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5">custos não cadastrados</p>
                  </>
                )}
              </div>

              {/* Margem */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Margem</p>
                {summary?.margemOp != null ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${summary.margemOp >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {summary.margemOp.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">margem operacional sobre receita</p>
                  </>
                ) : summary?.margemBruta != null ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${summary.margemBruta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {summary.margemBruta.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">margem bruta (s/ insumos)</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>
                    <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5">sem custo cadastrado</p>
                  </>
                )}
              </div>

              {/* Resultado s/ Insumos */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Resultado s/ Insumos</p>
                {dre?.lucroBruto != null ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${dre.lucroBruto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtRDRE(dre.lucroBruto)}
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">margem {pct(summary?.margemBruta ?? null)} · após custo de material</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>
                    <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5">custo de material não cadastrado</p>
                  </>
                )}
              </div>

              {/* Peças / Ticket */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Peças Vendidas</p>
                <p className="text-3xl font-black text-amber-600 leading-none">
                  {summary?.totalPecas ?? 0}
                </p>
                <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">
                  peças · ticket médio {fmtRDRE(summary?.ticketMedio ?? 0)}
                </p>
              </div>

            </div>
          </div>

          {/* ── 3. Fluxo de Insumos ─────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Fluxo de Insumos</p>
              <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">
                compras e consumo no período · saldo é snapshot atual
              </p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Entradas */}
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowUpRight size={14} className="text-emerald-600" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Compras (entradas)</p>
                  </div>
                  <p className="text-2xl font-black text-emerald-700 leading-none">
                    {fmtRDRE(data.materialFlow.entradas.total)}
                  </p>
                  <p className="text-[10px] text-emerald-600 mt-1.5">
                    {data.materialFlow.entradas.count} {data.materialFlow.entradas.count === 1 ? "lote comprado" : "lotes comprados"}
                  </p>
                </div>

                {/* Saídas */}
                <div className="rounded-xl bg-red-50 border border-red-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowDownRight size={14} className="text-red-600" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">Consumo (saídas)</p>
                  </div>
                  <p className="text-2xl font-black text-red-700 leading-none">
                    {data.materialFlow.saidas.total > 0
                      ? `(${fmtRDRE(data.materialFlow.saidas.total)})`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-red-600 mt-1.5">
                    {data.materialFlow.saidas.count} {data.materialFlow.saidas.count === 1 ? "bobina esgotada" : "bobinas esgotadas"}
                  </p>
                </div>

                {/* Saldo */}
                <div className="rounded-xl bg-[#4361EE]/5 border border-[#4361EE]/12 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={14} className="text-[#4361EE]" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#4361EE]">Saldo em Insumos</p>
                  </div>
                  <p className="text-2xl font-black text-[#4361EE] leading-none">
                    {fmtRDRE(stockVal?.rawMaterials.totalCost ?? null)}
                  </p>
                  <p className="text-[10px] text-[#4361EE]/60 mt-1.5">
                    snapshot atual · {stockVal?.rawMaterials.items.length ?? 0} lotes disponíveis
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── 4. Ranking de Produtos ───────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Ranking de Produtos</p>
              <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">pedidos concluídos no período · ordenado por receita</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                    {["#", "Produto", "Qtd", "Receita", "Custo", "Lucro", "Margem"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0F1E3C]/4">
                  {data.productRanking.slice(0, 20).map((p, i) => {
                    const lucro = p.cost !== null ? p.revenue - p.cost : null
                    return (
                      <tr key={p.name} className="hover:bg-[#F4F6FB] transition-colors">
                        <td className="px-4 py-3 text-[10px] font-bold text-[#0F1E3C]/30 w-8">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold text-[#0F1E3C] max-w-[180px] truncate">{p.name}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 tabular-nums">{p.qty}</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C] tabular-nums">{fmtRDRE(p.revenue)}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 tabular-nums">
                          {p.cost !== null ? fmtRDRE(p.cost) : <span className="text-[#0F1E3C]/20">—</span>}
                        </td>
                        <td className="px-4 py-3 font-bold tabular-nums">
                          {lucro !== null ? (
                            <span className={lucro >= 0 ? "text-emerald-600" : "text-red-600"}>
                              {fmtRDRE(lucro)}
                            </span>
                          ) : <span className="text-[#0F1E3C]/20">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {p.margin !== null ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              p.margin >= 50 ? "bg-emerald-100 text-emerald-700"
                              : p.margin >= 30 ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                            }`}>
                              {p.margin.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#0F1E3C]/20">sem custo</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {data.productRanking.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-[#0F1E3C]/25">
                        Sem produtos vendidos no período
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.productRanking.length > 0 && (() => {
                  const totalRevenue = data.productRanking.reduce((s, p) => s + p.revenue, 0)
                  const totalCost    = data.productRanking.filter(p => p.cost !== null).reduce((s, p) => s + (p.cost ?? 0), 0)
                  const hasCost      = data.productRanking.some(p => p.cost !== null)
                  const totalLucro   = hasCost ? totalRevenue - totalCost : null
                  const totalMargem  = hasCost && totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : null
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-[#0F1E3C]/10 bg-[#F4F6FB]">
                        <td colSpan={2} className="px-4 py-3 text-xs font-bold text-[#0F1E3C]/40 uppercase">Total</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C] tabular-nums">
                          {data.productRanking.reduce((s, p) => s + p.qty, 0)}
                        </td>
                        <td className="px-4 py-3 font-black text-[#0F1E3C] tabular-nums">{fmtRDRE(totalRevenue)}</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C]/60 tabular-nums">
                          {hasCost ? fmtRDRE(totalCost) : "—"}
                        </td>
                        <td className="px-4 py-3 font-black tabular-nums">
                          {totalLucro !== null ? (
                            <span className={totalLucro >= 0 ? "text-emerald-600" : "text-red-600"}>
                              {fmtRDRE(totalLucro)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {totalMargem !== null ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              totalMargem >= 50 ? "bg-emerald-100 text-emerald-700"
                              : totalMargem >= 30 ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                            }`}>
                              {totalMargem.toFixed(1)}%
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          </div>

          {/* ── 5. DRE — colapsível ─────────────────────────────────────────── */}
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
              {dreOpen
                ? <ChevronUp size={16} className="text-[#0F1E3C]/30" />
                : <ChevronDown size={16} className="text-[#0F1E3C]/30" />
              }
            </button>
            {dreOpen && (
              <div className="px-6 py-4">
                <DRERow bold label="(+) Receita Bruta" value={dre?.receitaBruta} />
                {(dre?.receitaAvarias ?? 0) > 0 && (
                  <DRERow label="↳ Avarias vendidas" value={dre?.receitaAvarias} indent
                    sub="vendas de peças com desconto" />
                )}
                <DRERow label="(-) Custo de Insumos" value={dre?.custoInsumos != null ? -(dre.custoInsumos) : null}
                  indent negative sub="material_cost dos produtos vendidos" />
                <DRERow separator />
                <DRERow bold label="Resultado s/ Insumos" value={dre?.lucroBruto}
                  sub={dre?.lucroBruto != null ? `margem ${pct(summary?.margemBruta ?? null)}` : undefined} />
                <DRERow label="(-) Custo de Costura" value={-(dre?.custoCostura ?? 0)} indent negative
                  sub={`${data.period.days}d proporcionais ao mês`} />
                <DRERow label="(-) Custo Fixo" value={-(dre?.custoFixo ?? 0)} indent negative />
                <DRERow label="(-) Custo Variável" value={-(dre?.custoVariavel ?? 0)} indent negative
                  sub="despesas variáveis lançadas no período" />
                {(dre?.perdasDescarte ?? 0) > 0 && (
                  <DRERow label="(-) Perdas por Descarte" value={-(dre?.perdasDescarte ?? 0)} indent negative
                    sub="qty × custo médio · avarias descartadas no período" />
                )}
                <DRERow separator />
                <DRERow bold label="Resultado Operacional" value={dre?.resultadoOp}
                  sub={dre?.resultadoOp != null ? `margem op. ${pct(summary?.margemOp ?? null)}` : undefined} />
              </div>
            )}
          </div>

          {/* ── 6. Balanço de Estoque — snapshot, colapsível ────────────────── */}
          {stockVal && (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <button
                onClick={() => setStockOpen(v => !v)}
                className="w-full flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/6 hover:bg-[#F4F6FB] transition-colors"
              >
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C] text-left">Balanço de Estoque</p>
                  <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5 text-left">
                    snapshot atual — não muda com o filtro de período
                  </p>
                </div>
                {stockOpen
                  ? <ChevronUp size={16} className="text-[#0F1E3C]/30" />
                  : <ChevronDown size={16} className="text-[#0F1E3C]/30" />
                }
              </button>

              {stockOpen && (
                <div className="p-6 space-y-5">
                  {/* KPI totais */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KPICard
                      label="Capital Total Imobilizado"
                      value={fmtRDRE(stockVal.grandTotalCost)}
                      sub="produtos + insumos ao custo"
                      icon={Layers} color="blue"
                    />
                    <KPICard
                      label="Capital em Produtos"
                      value={fmtRDRE(stockVal.products.totalCost)}
                      sub={`${stockVal.products.items.length} produtos em estoque`}
                      icon={Package}
                    />
                    <KPICard
                      label="Capital em Insumos"
                      value={fmtRDRE(stockVal.rawMaterials.totalCost)}
                      sub={`${stockVal.rawMaterials.items.length} lotes disponíveis`}
                      icon={Layers}
                    />
                    <KPICard
                      label="Receita Potencial (venda)"
                      value={fmtRDRE(stockVal.products.totalSale)}
                      sub={
                        stockVal.products.totalCost > 0
                          ? `margem potencial ${(((stockVal.products.totalSale - stockVal.products.totalCost) / stockVal.products.totalSale) * 100).toFixed(1)}%`
                          : undefined
                      }
                      icon={TrendingUp} color="green"
                    />
                  </div>

                  {/* Tabela simplificada: 1 linha por produto */}
                  {stockVal.products.items.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-[#0F1E3C]/6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                            {["Produto", "Qtd total", "Capital (custo)", "Potencial (venda)", "Margem%"].map(h => (
                              <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#0F1E3C]/4">
                          {stockVal.products.items.map((r, i) => {
                            const margem = r.totalSale > 0 && r.totalCost > 0
                              ? ((r.totalSale - r.totalCost) / r.totalSale) * 100
                              : null
                            return (
                              <tr key={i} className="hover:bg-[#F4F6FB] transition-colors">
                                <td className="px-4 py-3 font-semibold text-[#0F1E3C]">{r.productName}</td>
                                <td className="px-4 py-3 font-bold text-[#0F1E3C] tabular-nums">{r.qty}</td>
                                <td className="px-4 py-3 font-bold text-[#4361EE] tabular-nums">
                                  {r.costPrice > 0 ? fmtRDRE(r.totalCost) : "—"}
                                </td>
                                <td className="px-4 py-3 font-bold text-emerald-600 tabular-nums">
                                  {r.salePrice > 0 ? fmtRDRE(r.totalSale) : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  {margem !== null ? (
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                      margem >= 50 ? "bg-emerald-100 text-emerald-700"
                                      : margem >= 30 ? "bg-amber-100 text-amber-700"
                                      : "bg-red-100 text-red-700"
                                    }`}>
                                      {margem.toFixed(1)}%
                                    </span>
                                  ) : "—"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#0F1E3C]/8 bg-[#F4F6FB]">
                            <td className="px-4 py-2.5 text-xs font-bold text-[#0F1E3C]/40 uppercase">Total</td>
                            <td className="px-4 py-2.5 font-black text-[#0F1E3C] tabular-nums">
                              {stockVal.products.items.reduce((s, r) => s + r.qty, 0)}
                            </td>
                            <td className="px-4 py-2.5 font-black text-[#4361EE] tabular-nums">
                              {fmtRDRE(stockVal.products.totalCost)}
                            </td>
                            <td className="px-4 py-2.5 font-black text-emerald-600 tabular-nums">
                              {fmtRDRE(stockVal.products.totalSale)}
                            </td>
                            <td className="px-4 py-2.5" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </>
      )}
    </div>
  )
}
