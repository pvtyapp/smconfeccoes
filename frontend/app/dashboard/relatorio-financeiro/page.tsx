"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import {
  RefreshCw, TrendingUp, Package, FileDown,
  ChevronDown, ChevronUp, Layers, Store, AlertTriangle,
} from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"
import RelatorioPrintSheet from "./RelatorioPrintSheet"
import { printWhenReady } from "@/components/print/print-utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type DRE = {
  receitaBruta:   number
  receitaAvarias: number
  custoInsumos:   number | null
  lucroBruto:     number | null
  custoCostura:   number
  custoFixo:      number
  custoVariavel:  number
  perdasDescarte: number
  despesasPagas:      number
  despesasPagasCount: number
  resultadoOp:    number | null
}

export type Summary = {
  pedidosTotal:      number
  pedidosConcluidos: number
  totalPecas:        number
  ticketMedio:       number
  margemBruta:       number | null
  margemOp:          number | null
}

export type ProductRow = {
  name:    string
  revenue: number
  cost:    number | null
  margin:  number | null
  qty:     number
}

export type MaterialFlow = {
  entradas: { total: number; count: number }
  saidas:   { total: number; count: number }
}

export type LojaMkt = {
  loja: string; pedidos: number; pecas: number; dias: number
  vendas: number; taxas: number; cupom: number; frete: number; ads: number; custo: number; custoIncompleto: boolean
}

export type MarketplaceCusto = {
  custo: number
  pecas: number
  separacoes: number
  custoIncompleto: boolean
  vendas: number
  lojas: LojaMkt[]
}

// DRE completo (PIV 06/11): lucro de verdade, com o marketplace dentro
export type DreCompleto = {
  aliquota: number
  receitaBruta: number; receitaLoja: number; receitaMarketplace: number
  taxasMarketplace: number; cupomMarketplace: number; freteMarketplace: number; impostos: number
  receitaLiquida: number
  custoPecasLoja: number | null; custoPecasMarketplace: number; cmv: number
  lucroBruto: number
  adsMarketplace: number; custoVariavel: number; custoFixo: number; perdasDescarte: number
  lucroLiquido: number
  margemBruta: number | null; margemLiquida: number | null
  custoIncompleto: boolean
}

export type CanalLucro = {
  canal: string; nome: string; receita: number; deducoes: number; custo: number | null; ads: number; lucro: number | null; margem: number | null
}

export type ReportData = {
  period:         { from: string; to: string; days: number }
  dre:            DRE
  summary:        Summary
  byChannel:      Record<string, number>
  marketplace:    MarketplaceCusto
  completo:       DreCompleto
  canais:         CanalLucro[]
  productRanking: ProductRow[]
  materialFlow:   MaterialFlow
  diagnostico:    { semCusto: string[]; dtfSemCusto: boolean }
}

export type StockItem = {
  productName: string
  qty:         number
  costPrice:   number
  salePrice:   number
  totalCost:   number
  totalSale:   number
}
export type RawItem = {
  materialName: string; variantName: string; unit: string
  qty: number; unitPrice: number; totalCost: number
}
export type StockValuation = {
  products:     { items: StockItem[]; totalCost: number; totalSale: number }
  rawMaterials: { items: RawItem[];   totalCost: number }
  grandTotalCost: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

type PresetKey = "hoje" | "ontem" | "mes_atual" | "mes_anterior" | "7d" | "30d" | "60d" | "range"

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje",         label: "Hoje"         },
  { key: "ontem",        label: "Ontem"        },
  { key: "mes_atual",    label: "Mês atual"    },
  { key: "mes_anterior", label: "Mês anterior" },
  { key: "7d",           label: "7 dias"       },
  { key: "30d",          label: "30 dias"      },
  { key: "60d",          label: "60 dias"      },
  { key: "range",        label: "Período"      },
]

export const CHANNEL_LABEL: Record<string, string> = {
  pdv:      "PDV",
  whatsapp: "WhatsApp",
  site:     "Site",
  dtf:      "DTF",
}

const CHANNEL_COLOR: Record<string, string> = {
  pdv:      "#4361EE",
  whatsapp: "#10B981",
  site:     "#EC4899",
  dtf:      "#7C3AED",
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
    case "hoje":         return [t, t]
    case "ontem":        { const d = subDaysBR(1); return [d, d] }
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
  const [dreOpen,    setDreOpen]    = useState(true)
  const [aliqEdit,   setAliqEdit]   = useState<string | null>(null)
  const [aliqSaving, setAliqSaving] = useState(false)
  const [stockOpen,  setStockOpen]  = useState(true)
  const [stockVal,   setStockVal]   = useState<StockValuation | null>(null)
  const [showReport, setShowReport] = useState(false)

  function handleExtrairRelatorio() {
    setShowReport(true)
    printWhenReady()
  }

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
  const comp         = data?.completo
  const channelTotal = Object.values(data?.byChannel ?? {}).reduce((s, v) => s + v, 0) + (data?.marketplace.vendas ?? 0)
  const pedidosMkt   = (data?.marketplace.lojas ?? []).reduce((n, l) => n + l.pedidos, 0)

  async function salvarAliquota() {
    if (aliqEdit === null) return
    setAliqSaving(true)
    try {
      const r = await fetch("/api/relatorio-financeiro/imposto", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aliquota: aliqEdit }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "Não deu pra salvar a alíquota"); return }
      setAliqEdit(null); await load()
    } finally { setAliqSaving(false) }
  }

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
        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={handleExtrairRelatorio}
              className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              <FileDown size={14} /> Extrair Relatório
            </button>
          )}
          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors border border-[#0F1E3C]/8">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
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

          {data.diagnostico.dtfSemCusto && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs font-bold text-amber-700 mb-1">
                Lucro e margem de DTF indisponíveis — teve venda de DTF no período, mas o produto &ldquo;DTF 60cm&rdquo;
                não tem custo cadastrado.
              </p>
              <p className="text-[10px] text-amber-500 mt-1">
                Acesse Produtos, abra o DTF e salve o campo &ldquo;Preço de custo&rdquo;.
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
              {Object.keys(data.byChannel).length === 0 && data.marketplace.vendas === 0 ? (
                <p className="text-sm text-center text-[#0F1E3C]/30 py-4">Sem vendas concluídas no período</p>
              ) : (
                <>
                  {/* Canal cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                    {(["pdv", "whatsapp", "site", "dtf"] as const).map(ch => {
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

                    {/* Marketplace (PIV 06/11): receita das lojas da SM pelo fechamento diário
                        (marketplace_fechamentos); entra no total e no DRE. */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Store size={11} className="text-amber-700/70" />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Marketplace</p>
                      </div>
                      <p className="text-2xl font-black leading-none text-amber-700">
                        {data.marketplace.vendas > 0 ? fmtRDRE(data.marketplace.vendas) : "—"}
                      </p>
                      <div className="mt-3 h-1.5 bg-[#0F1E3C]/6 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{ width: `${channelTotal > 0 ? (data.marketplace.vendas / channelTotal) * 100 : 0}%` }} />
                      </div>
                      <p className="text-[10px] text-amber-700/60 mt-1.5 font-semibold">
                        {data.marketplace.lojas.map(l => `${l.loja.replace("SHP_", "Shopee ").replace("TKTK_", "TikTok ")} ${fmtRDRE(l.vendas)}`).join(" · ") || "sem fechamento no período"}
                      </p>
                      {data.marketplace.custoIncompleto && (
                        <p className="text-[9px] text-amber-700 mt-1 flex items-center gap-1">
                          <AlertTriangle size={10} /> dia ou item sem custo no fechamento
                        </p>
                      )}
                      <Link href="/dashboard/marketplace-painel"
                        className="text-[10px] font-bold text-amber-700 hover:underline mt-2 inline-block">
                        Ver painel do marketplace →
                      </Link>
                    </div>
                  </div>
                  {/* Total */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#0F1E3C]/6">
                    <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">
                      Total · {summary?.pedidosConcluidos ?? 0} pedidos concluídos{pedidosMkt > 0 ? ` + ${pedidosMkt} do marketplace` : ""}
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
                  {fmtRDRE(comp?.receitaBruta ?? dre?.receitaBruta ?? 0)}
                </p>
                <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">
                  loja {fmtRDRE(comp?.receitaLoja ?? 0)} · marketplace {fmtRDRE(comp?.receitaMarketplace ?? 0)}
                </p>
              </div>

              {/* Lucro líquido (PIV 06/11) */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Lucro líquido</p>
                {comp ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${comp.lucroLiquido >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtRDRE(comp.lucroLiquido)}
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">
                      depois de taxas, imposto, peças, ads e custo fixo
                      {comp.custoIncompleto && <span className="ml-1 text-amber-600 font-semibold">· tem custo faltando</span>}
                    </p>
                  </>
                ) : <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>}
              </div>

              {/* Margem líquida */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Margem líquida</p>
                {comp?.margemLiquida != null ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${comp.margemLiquida >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {comp.margemLiquida.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">lucro líquido sobre a receita bruta</p>
                  </>
                ) : <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>}
              </div>

              {/* Lucro bruto */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">Lucro bruto</p>
                {comp ? (
                  <>
                    <p className={`text-3xl font-black leading-none ${comp.lucroBruto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtRDRE(comp.lucroBruto)}
                    </p>
                    <p className="text-[10px] text-[#0F1E3C]/40 mt-1.5">margem {pct(comp.margemBruta)} · receita líquida menos o custo das peças</p>
                  </>
                ) : <p className="text-3xl font-black leading-none text-[#0F1E3C]/20">—</p>}
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

          {/* Fluxo de Insumos (matéria-prima da Produção) saiu com a Produção (PIV 05/11) */}

          {/* ── 3. Lucro por Canal (PIV 06/11) ─────────────────────────────── */}
          {(data.canais?.length ?? 0) > 0 && (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
                <p className="text-sm font-bold text-[#0F1E3C]">Lucro por Canal</p>
                <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">receita − imposto, taxas, cupom e frete − custo das peças − ads · custo fixo e variável ficam só no total</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#0F1E3C]/5 bg-[#F4F6FB]">
                      {["Canal", "Receita", "Deduções", "Custo das peças", "Ads", "Lucro", "Margem"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0F1E3C]/4">
                    {data.canais.map(c => (
                      <tr key={c.canal} className="hover:bg-[#F4F6FB] transition-colors">
                        <td className="px-4 py-3 font-semibold text-[#0F1E3C] whitespace-nowrap">{c.nome}</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C] tabular-nums">{fmtRDRE(c.receita)}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 tabular-nums">{c.deducoes > 0 ? `(${fmtRDRE(c.deducoes)})` : "—"}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 tabular-nums">
                          {c.custo == null ? <span className="text-amber-600 text-xs">sem custo</span> : c.custo > 0 ? `(${fmtRDRE(c.custo)})` : "—"}
                        </td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 tabular-nums">{c.ads > 0 ? `(${fmtRDRE(c.ads)})` : "—"}</td>
                        <td className="px-4 py-3 font-bold tabular-nums">
                          {c.lucro == null ? <span className="text-[#0F1E3C]/20">—</span>
                            : <span className={c.lucro >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtRDRE(c.lucro)}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.margem == null ? <span className="text-[10px] text-[#0F1E3C]/20">—</span> : (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              c.margem >= 30 ? "bg-emerald-100 text-emerald-700" : c.margem >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            }`}>{c.margem.toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
            {dreOpen && comp && (
              <div className="px-6 py-4">
                <DRERow bold label="(+) Receita Bruta" value={comp.receitaBruta} />
                <DRERow label="Loja (balcão, WhatsApp, site, DTF, avarias)" value={comp.receitaLoja} indent />
                <DRERow label="Marketplace (Shopee e TikTok)" value={comp.receitaMarketplace} indent
                  sub={data.marketplace.lojas.length ? `${data.marketplace.lojas.map(l => l.loja).join(", ")} · fechamento diário` : "sem fechamento no período"} />
                <DRERow label="(-) Taxas e comissões do marketplace" value={-comp.taxasMarketplace} indent negative />
                {comp.cupomMarketplace > 0 && <DRERow label="(-) Cupons do marketplace" value={-comp.cupomMarketplace} indent negative />}
                {comp.freteMarketplace > 0 && <DRERow label="(-) Frete do marketplace" value={-comp.freteMarketplace} indent negative />}
                <div className="flex items-center justify-between py-2 pl-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[#0F1E3C]/25 text-xs">↳</span>
                    <span className="text-sm text-[#0F1E3C]/70">(-) Impostos</span>
                    {aliqEdit === null ? (
                      <button onClick={() => setAliqEdit(String(comp.aliquota))}
                        className="text-[10px] font-bold text-[#4361EE] hover:underline">
                        {comp.aliquota > 0 ? `${comp.aliquota}% sobre a venda · editar` : "definir alíquota"}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1">
                        <input value={aliqEdit} onChange={e => setAliqEdit(e.target.value)} inputMode="decimal"
                          className="w-16 px-2 py-0.5 rounded-md border border-[#0F1E3C]/15 text-xs text-right focus:outline-none focus:ring-2 focus:ring-[#4361EE]/25" />
                        <span className="text-xs text-[#0F1E3C]/50">%</span>
                        <button onClick={salvarAliquota} disabled={aliqSaving}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#4361EE] text-white disabled:opacity-50">
                          {aliqSaving ? "Salvando…" : "Salvar"}
                        </button>
                        <button onClick={() => setAliqEdit(null)} className="text-[10px] text-[#0F1E3C]/40 hover:underline">cancelar</button>
                      </span>
                    )}
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${comp.impostos > 0 ? "text-red-600" : "text-[#0F1E3C]/25"}`}>
                    {comp.impostos > 0 ? fmtRDRE(-comp.impostos) : "—"}
                  </span>
                </div>
                <DRERow separator />
                <DRERow bold label="= Receita Líquida" value={comp.receitaLiquida} />
                <DRERow label="(-) Custo das peças vendidas na loja" value={comp.custoPecasLoja != null ? -comp.custoPecasLoja : null} indent negative
                  sub="custo cadastrado × qtd, inclui o DTF" />
                <DRERow label="(-) Custo das peças do marketplace" value={-comp.custoPecasMarketplace} indent negative
                  sub="pelo fechamento diário de cada loja" />
                <DRERow separator />
                <DRERow bold label="= Lucro Bruto" value={comp.lucroBruto} sub={`margem ${pct(comp.margemBruta)}`} />
                <DRERow label="(-) Ads do marketplace" value={-comp.adsMarketplace} indent negative />
                <DRERow label="(-) Custo variável" value={-comp.custoVariavel} indent negative sub="despesas variáveis lançadas no período" />
                <DRERow label="(-) Custo fixo" value={-comp.custoFixo} indent negative
                  sub={`${data.period.days}d proporcionais ao mês · aluguel, energia, folha`} />
                {comp.perdasDescarte > 0 && (
                  <DRERow label="(-) Perdas por descarte" value={-comp.perdasDescarte} indent negative sub="avarias descartadas no período" />
                )}
                <DRERow separator />
                <DRERow bold label="= Lucro Líquido" value={comp.lucroLiquido} sub={`margem líquida ${pct(comp.margemLiquida)}`} />
                {comp.custoIncompleto && (
                  <p className="text-[10px] text-amber-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertTriangle size={10} /> Tem produto, DTF ou dia do marketplace sem custo: o lucro real é menor que o mostrado.
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-dashed border-[#0F1E3C]/10">
                  <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider mb-1">
                    Referência — não desconta do lucro acima
                  </p>
                  <DRERow label="Custo de Costura (simulador)" value={dre?.custoCostura ?? 0} indent
                    sub={`${data.period.days}d proporcionais ao mês · use pra ajustar o custo cadastrado do produto`} />
                  {(dre?.despesasPagas ?? 0) > 0 && (
                    <DRERow label="Contas a Pagar quitadas" value={dre?.despesasPagas ?? 0} indent
                      sub={`${dre?.despesasPagasCount ?? 0} conta${(dre?.despesasPagasCount ?? 0) !== 1 ? "s" : ""} paga${(dre?.despesasPagasCount ?? 0) !== 1 ? "s" : ""} no período`} />
                  )}
                </div>
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
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    <KPICard
                      label="Capital Total Imobilizado"
                      value={fmtRDRE(stockVal.grandTotalCost)}
                      sub="peças em estoque, ao custo cadastrado"
                      icon={Layers} color="blue"
                    />
                    <KPICard
                      label="Capital em Produtos"
                      value={fmtRDRE(stockVal.products.totalCost)}
                      sub={`${stockVal.products.items.length} produtos em estoque`}
                      icon={Package}
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

      {showReport && data && (
        <RelatorioPrintSheet
          data={data}
          stockVal={stockVal}
          onDone={() => setShowReport(false)}
        />
      )}
    </div>
  )
}
