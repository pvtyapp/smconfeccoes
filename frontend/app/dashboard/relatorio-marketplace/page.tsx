"use client"

import { useState, useCallback, useEffect } from "react"
import { RefreshCw, Pencil, Check, X, DollarSign, Package, TrendingUp, AlertTriangle } from "lucide-react"
import { todayBR, subDaysBR, fmtDateOnlyBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

// ─── Types ────────────────────────────────────────────────────────────────────

type DayRow = {
  date: string
  pecas: number
  separacoes: number
  custo: number
  custoIncompleto: boolean
  receita: number
  isReal: boolean
  lucro: number
  margem: number | null
}

type ReportData = {
  period: { from: string; to: string }
  markupPercent: number
  days: DayRow[]
  summary: {
    totalPecas: number
    totalCusto: number
    totalReceita: number
    totalLucro: number
    margem: number | null
    diasComCustoIncompleto: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

type PresetKey = "hoje" | "ontem" | "7d" | "30d" | "mes_atual" | "range"

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje",      label: "Hoje"      },
  { key: "ontem",     label: "Ontem"     },
  { key: "7d",        label: "7 dias"    },
  { key: "30d",       label: "30 dias"   },
  { key: "mes_atual", label: "Mês atual" },
  { key: "range",     label: "Período"   },
]

function getPresetDates(key: PresetKey, rs: string, re: string): [string, string] | null {
  const t = todayBR()
  const [y, m] = t.split("-").map(Number)
  switch (key) {
    case "hoje":      return [t, t]
    case "ontem":     { const d = subDaysBR(1); return [d, d] }
    case "7d":        return [subDaysBR(6), t]
    case "30d":       return [subDaysBR(29), t]
    case "mes_atual":  return [`${y}-${String(m).padStart(2, "0")}-01`, t]
    case "range":      return (rs && re) ? [rs, re] : null
  }
}

function pct(v: number | null) {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RelatorioMarketplacePage() {
  const [preset,     setPreset]     = useState<PresetKey>("30d")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd,   setRangeEnd]   = useState("")
  const [data,       setData]       = useState<ReportData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")

  const [markupInput, setMarkupInput] = useState("")
  const [savingMarkup, setSavingMarkup] = useState(false)

  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [editValue,   setEditValue]   = useState("")
  const [savingEdit,  setSavingEdit]  = useState(false)

  const load = useCallback(async () => {
    const dates = getPresetDates(preset, rangeStart, rangeEnd)
    if (!dates) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/marketplace/relatorio?from=${dates[0]}&to=${dates[1]}`)
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      const json: ReportData = await res.json()
      setData(json)
      setMarkupInput(String(json.markupPercent))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    } finally {
      setLoading(false)
    }
  }, [preset, rangeStart, rangeEnd])

  useEffect(() => { load() }, [load])

  async function saveMarkup() {
    const val = Number(markupInput)
    if (Number.isNaN(val) || val < 0) return
    setSavingMarkup(true)
    try {
      await fetch("/api/marketplace/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markupPercent: val }),
      })
      await load()
    } finally {
      setSavingMarkup(false)
    }
  }

  function startEdit(row: DayRow) {
    setEditingDate(row.date)
    setEditValue(row.isReal ? String(row.receita) : "")
  }

  async function saveEdit(date: string) {
    setSavingEdit(true)
    try {
      const valor = editValue.trim() === "" ? null : Number(editValue)
      if (valor !== null && Number.isNaN(valor)) return
      await fetch("/api/marketplace/relatorio/receita", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, valor }),
      })
      setEditingDate(null)
      await load()
    } finally {
      setSavingEdit(false)
    }
  }

  const summary = data?.summary

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Financeiro Marketplace
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">
            Custo real do que foi separado, receita digitada ou estimada por dia.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors border border-[#0F1E3C]/8">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Config de markup */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-bold text-[#0F1E3C]">Margem de trabalho (markup)</p>
          <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">
            Usada pra estimar a receita nos dias em que você não digitou o valor real vendido. Receita estimada = custo × (1 + markup%).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="number" min={0} step="1" value={markupInput}
              onChange={e => setMarkupInput(e.target.value)}
              className="w-24 pr-7 pl-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] text-right focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#0F1E3C]/40">%</span>
          </div>
          <button
            onClick={saveMarkup} disabled={savingMarkup}
            className="flex items-center gap-1.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {savingMarkup ? "Salvando..." : "Salvar"}
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
      ) : data && summary && (
        <>
          {summary.diasComCustoIncompleto > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                {summary.diasComCustoIncompleto} dia(s) no período têm produto sem &ldquo;Preço de custo&rdquo; cadastrado — o custo desses dias está subestimado.
              </p>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPICard label="Peças" value={String(summary.totalPecas)} icon={Package} color="blue" />
            <KPICard label="Custo" value={fmtR(summary.totalCusto)} icon={DollarSign} color="amber" />
            <KPICard label="Receita" value={fmtR(summary.totalReceita)} icon={DollarSign} color="blue" />
            <KPICard label="Lucro" value={fmtR(summary.totalLucro)} icon={TrendingUp}
              color={summary.totalLucro >= 0 ? "green" : "red"} />
            <KPICard label="Margem" value={pct(summary.margem)} icon={TrendingUp}
              color={summary.margem !== null && summary.margem >= 0 ? "green" : "red"} />
          </div>

          {/* Tabela por dia */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#0F1E3C]/6">
              <p className="text-sm font-bold text-[#0F1E3C]">Por dia</p>
              <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">
                {data.period.from} → {data.period.to} · clique no lápis pra digitar a receita real de um dia
              </p>
            </div>
            {data.days.length === 0 ? (
              <p className="text-sm text-center text-[#0F1E3C]/30 py-10">Nenhuma separação de marketplace no período</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#0F1E3C]/6 text-[10px] uppercase tracking-wider text-[#0F1E3C]/40">
                      <th className="text-left  px-6 py-2.5 font-semibold">Data</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Peças</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Custo</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Receita</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Lucro</th>
                      <th className="text-right px-6 py-2.5 font-semibold">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map(row => (
                      <tr key={row.date} className="border-b border-[#0F1E3C]/4 last:border-0 hover:bg-[#0F1E3C]/2">
                        <td className="px-6 py-3 text-[#0F1E3C] font-medium tabular-nums">
                          {fmtDateOnlyBR(row.date)}
                          {row.custoIncompleto && (
                            <span title="Produto sem custo cadastrado nesse dia">
                              <AlertTriangle size={11} className="inline ml-1.5 text-amber-500 mb-0.5" />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-[#0F1E3C]/70 tabular-nums">{row.pecas}</td>
                        <td className="px-4 py-3 text-right text-[#0F1E3C]/70 tabular-nums">{fmtR(row.custo)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {editingDate === row.date ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number" min={0} step="0.01" autoFocus value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                placeholder="valor real"
                                className="w-24 px-2 py-1 rounded-md border border-[#4361EE]/30 text-right text-xs focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                              />
                              <button onClick={() => saveEdit(row.date)} disabled={savingEdit}
                                className="p-1 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50">
                                <Check size={12} />
                              </button>
                              <button onClick={() => setEditingDate(null)} disabled={savingEdit}
                                className="p-1 rounded-md bg-[#0F1E3C]/6 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/12">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                                row.isReal ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                              }`}>
                                {row.isReal ? "Real" : "Estimado"}
                              </span>
                              <span className="text-[#0F1E3C]/70">{fmtR(row.receita)}</span>
                              <button onClick={() => startEdit(row)}
                                className="p-1 rounded-md text-[#0F1E3C]/25 hover:text-[#4361EE] hover:bg-[#4361EE]/8">
                                <Pencil size={11} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold tabular-nums ${row.lucro >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {fmtR(row.lucro)}
                        </td>
                        <td className="px-6 py-3 text-right text-[#0F1E3C]/70 tabular-nums">{pct(row.margem)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
