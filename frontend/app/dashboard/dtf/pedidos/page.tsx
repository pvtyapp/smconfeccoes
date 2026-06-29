"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Printer, FlaskConical, TrendingDown, X, AlertTriangle } from "lucide-react"
import MetricCard from "@/components/cards/MetricCard"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

// ─── Types ──────────────────────────────────────────────────────────────────────
type PeriodKey = "hoje" | "7d" | "30d" | "90d" | "range"

type Pedido = {
  id: number; data: string; cliente: string | null
  metros: number; precoCobrado: number | null; observacao: string | null
}

type InsumoSummary = {
  id: number; nome: string; unidade: string
  saldoAtual: number; alarmeQtd: number | null; lowStock: boolean
  consumoMedioPorMetro: number | null; diasRestantes: number | null
}

type ImpressoraMetric = { impressoraId: number; metros: number; pedidos: number }

type Relatorio = {
  pedidos: Pedido[]
  totalMetros: number
  totalReceita: number
  insumos: Array<{ id: number; nome: string; custoPorMetroAtual: number | null }>
  custoCombinado: number | null
  impressoras: ImpressoraMetric[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje"    },
  { key: "7d",   label: "7d"      },
  { key: "30d",  label: "30d"     },
  { key: "90d",  label: "90d"     },
  { key: "range",label: "Período" },
]

function getPeriodDates(key: PeriodKey, rs: string, re: string): [string, string] {
  const t = todayBR()
  switch (key) {
    case "hoje":  return [t, t]
    case "7d":    return [subDaysBR(6),  t]
    case "30d":   return [subDaysBR(29), t]
    case "90d":   return [subDaysBR(89), t]
    case "range": return [rs, re]
  }
}

function periodLabel(key: PeriodKey, rs: string, re: string) {
  if (key !== "range") return PERIOD_OPTIONS.find(p => p.key === key)?.label ?? ""
  if (!rs || !re) return "Período"
  const fmt = (s: string) => { const [, m, d] = s.split("-"); return `${d}/${m}` }
  return `${fmt(rs)} – ${fmt(re)}`
}

function fmtCpm(v: number | null | undefined) {
  if (v == null) return "—"
  return `R$ ${Number(v).toFixed(4).replace(".", ",")}/m`
}
function fmtData(s: string) { return fmtDateBR(s) }

const INSUMO_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Tinta:     { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"   },
  Film:      { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  Poliamida: { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200"  },
}

// ─── Page ────────────────────────────────────────────────────────────────────────
export default function DTFDashboardPage() {
  const [period,     setPeriod]     = useState<PeriodKey>("30d")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd,   setRangeEnd]   = useState("")

  const [relatorio,      setRelatorio]      = useState<Relatorio | null>(null)
  const [insumos,        setInsumos]        = useState<InsumoSummary[]>([])
  const [loading,        setLoading]        = useState(true)
  const [precoMetro,     setPrecoMetro]     = useState<number | null>(null)
  const [numImpressoras, setNumImpressoras] = useState(1)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    data: todayBR(),
    cliente: "", metros: "", precoCobrado: "", observacao: "",
  })

  const loadRelatorio = useCallback(async () => {
    const [from, to] = getPeriodDates(period, rangeStart, rangeEnd)
    if (period === "range" && (!rangeStart || !rangeEnd)) return
    setLoading(true)
    try {
      const r = await fetch(`/api/dtf/relatorio?from=${from}&to=${to}`)
      if (r.ok) setRelatorio(await r.json())
    } finally {
      setLoading(false)
    }
  }, [period, rangeStart, rangeEnd])

  const loadInsumos = useCallback(async () => {
    const r = await fetch("/api/dtf/insumos")
    if (r.ok) setInsumos(await r.json())
  }, [])

  useEffect(() => { loadRelatorio() }, [loadRelatorio])
  useEffect(() => { loadInsumos() },   [loadInsumos])
  useEffect(() => {
    fetch("/api/dtf/preco").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.precoMetro) setPrecoMetro(d.precoMetro)
    })
    fetch("/api/settings").then(r => r.ok ? r.json() : null).then((d: Record<string, string> | null) => {
      if (d?.dtf_num_impressoras) setNumImpressoras(Number(d.dtf_num_impressoras) || 1)
    })
  }, [])

  async function salvar() {
    if (!form.data || !form.metros) return
    const r = await fetch("/api/dtf/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: form.data,
        cliente: form.cliente || null,
        metros: parseFloat(form.metros),
        precoCobrado: form.precoCobrado ? parseFloat(form.precoCobrado) : null,
        observacao: form.observacao || null,
      }),
    })
    if (r.ok) {
      setForm({ data: todayBR(), cliente: "", metros: "", precoCobrado: "", observacao: "" })
      setShowForm(false)
      loadRelatorio()
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir este pedido?")) return
    await fetch(`/api/dtf/pedidos/${id}`, { method: "DELETE" })
    loadRelatorio()
  }

  const custoEstimado = relatorio?.custoCombinado && relatorio?.totalMetros
    ? relatorio.totalMetros * relatorio.custoCombinado : null
  const margem = relatorio?.totalReceita && custoEstimado
    ? ((relatorio.totalReceita - custoEstimado) / relatorio.totalReceita) * 100 : null

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Dashboard DTF
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Produção, custo e margem por período</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setPeriod(opt.key)}
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

      {/* ── Cards período ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Printer size={14} className="text-[#4361EE]"/>
          <h2 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">
            Produção — {periodLabel(period, rangeStart, rangeEnd)}
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse"/>
              ))
            : [
                { title: "Pedidos",         value: String(relatorio?.pedidos.length ?? 0)                           },
                { title: "Metros",           value: `${Number(relatorio?.totalMetros ?? 0).toFixed(2)} m`            },
                { title: "Receita",          value: fmtR(relatorio?.totalReceita ?? 0)                               },
                { title: "Custo estimado",   value: fmtR(custoEstimado)                                              },
                { title: "Margem estimada",  value: margem != null ? `${margem.toFixed(1)}%` : "—",
                  color: margem == null ? "default" : margem >= 40 ? "green" : margem >= 20 ? "yellow" : "red"       },
              ].map(c => (
                <MetricCard key={c.title} title={c.title} value={c.value} color={(c as { color?: string }).color as "blue" | "green" | "red" | "yellow" | "default" | undefined ?? "blue"}/>
              ))
          }
        </div>

        {/* Cards por impressora — só com múltiplas impressoras e dados */}
        {!loading && numImpressoras > 1 && (relatorio?.impressoras ?? []).length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Por impressora</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(relatorio?.impressoras ?? []).map(imp => (
                <div key={imp.impressoraId} className="bg-white rounded-2xl border border-blue-200 px-4 py-3">
                  <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-1">
                    Impressora {imp.impressoraId}
                  </p>
                  <p className="text-lg font-black text-[#0F1E3C]">{Number(imp.metros).toFixed(2)} m</p>
                  <p className="text-[10px] text-[#0F1E3C]/40">{imp.pedidos} pedido{imp.pedidos !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Alerta estoque baixo ── */}
      {insumos.some(i => i.lowStock) && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700 mb-1">Estoque baixo — reposição necessária</p>
            <div className="space-y-0.5">
              {insumos.filter(i => i.lowStock).map(i => (
                <p key={i.id} className="text-xs text-red-600">
                  {i.nome}: {parseFloat(Number(i.saldoAtual).toFixed(3))} {i.unidade} restantes
                  {i.alarmeQtd != null && ` (alarme: ${parseFloat(Number(i.alarmeQtd).toFixed(3))} ${i.unidade})`}
                  {i.diasRestantes != null && ` · ~${i.diasRestantes} dias`}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Insumos — estoque e consumo ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-[#0F1E3C]/35"/>
          <h2 className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Insumos — Estoque Atual</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {insumos.map(ins => {
            const clr = INSUMO_COLOR[ins.nome] || { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" }
            return (
              <div key={ins.id} className={`rounded-2xl border p-5 ${ins.lowStock ? "bg-red-50 border-red-200" : `${clr.bg} ${clr.border}`}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-black uppercase tracking-widest ${ins.lowStock ? "text-red-600" : clr.text}`}>
                    {ins.nome}
                  </span>
                  <div className="flex items-center gap-2">
                    {ins.lowStock && <AlertTriangle size={12} className="text-red-500" />}
                    <span className={`text-[10px] font-semibold opacity-60 ${ins.lowStock ? "text-red-600" : clr.text}`}>{ins.unidade}</span>
                  </div>
                </div>
                <p className={`text-2xl font-black ${ins.lowStock ? "text-red-600" : clr.text}`}>
                  {parseFloat(Number(ins.saldoAtual).toFixed(3))} {ins.unidade}
                </p>
                <p className={`text-xs mt-2 opacity-60 ${ins.lowStock ? "text-red-600" : clr.text}`}>
                  {ins.consumoMedioPorMetro != null
                    ? `${parseFloat(Number(ins.consumoMedioPorMetro).toFixed(4))} ${ins.unidade}/m impresso`
                    : "Sem dados de consumo"}
                </p>
                {ins.diasRestantes != null && (
                  <p className={`text-[10px] mt-0.5 opacity-50 ${ins.lowStock ? "text-red-600" : clr.text}`}>
                    ~{ins.diasRestantes} dias estimados
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Pedidos do período ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown size={14} className="text-[#0F1E3C]/35"/>
            <h2 className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Pedidos no Período</h2>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 bg-[#4361EE] text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-[#3451d1] transition-colors"
          >
            {showForm ? <X size={13}/> : <Plus size={13}/>}
            {showForm ? "Cancelar" : "Lançar Pedido"}
          </button>
        </div>

        {/* Formulário inline */}
        {showForm && (
          <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl shadow-sm p-5 space-y-4">
            <p className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Novo Pedido</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Data *</label>
                <input type="date" value={form.data}
                  onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Metros *</label>
                <input type="number" step="0.01" min="0" placeholder="0,00" value={form.metros}
                  onChange={e => {
                    const metros = e.target.value
                    const calc = precoMetro && metros ? (parseFloat(metros) * precoMetro).toFixed(2) : ""
                    setForm(f => ({ ...f, metros, precoCobrado: calc }))
                  }}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Cliente</label>
                <input type="text" placeholder="Nome" value={form.cliente}
                  onChange={e => setForm(f => ({ ...f, cliente: e.target.value }))}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">
                  Preço cobrado
                  {precoMetro && <span className="ml-1 text-[#4361EE]/60">(R$ {precoMetro.toFixed(2)}/m)</span>}
                </label>
                <input type="number" step="0.01" min="0" placeholder="R$ 0,00" value={form.precoCobrado}
                  onChange={e => setForm(f => ({ ...f, precoCobrado: e.target.value }))}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Observação</label>
                <input type="text" placeholder="Opcional" value={form.observacao}
                  onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
            </div>
            <button onClick={salvar}
              className="bg-[#4361EE] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#3451d1] transition-colors">
              Salvar
            </button>
          </div>
        )}

        {/* Tabela */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : !relatorio?.pedidos.length ? (
            <p className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhum pedido neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#0F1E3C]/8 bg-[#F9FAFB]">
                    {["Data","Cliente","Metros","Preço","Custo est.","Margem",""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {relatorio.pedidos.map((p, i) => {
                    const custo = relatorio.custoCombinado ? Number(p.metros) * relatorio.custoCombinado : null
                    const mgm   = p.precoCobrado && custo
                      ? ((Number(p.precoCobrado) - custo) / Number(p.precoCobrado)) * 100 : null
                    return (
                      <tr key={p.id}
                        className={`border-b border-[#0F1E3C]/4 last:border-0 ${i % 2 === 1 ? "bg-[#F9FAFB]/50" : ""} hover:bg-[#F4F6FB] transition-colors`}>
                        <td className="px-4 py-3 text-[#0F1E3C]/60">{fmtData(p.data)}</td>
                        <td className="px-4 py-3 font-medium text-[#0F1E3C]">{p.cliente || <span className="text-[#0F1E3C]/25">—</span>}</td>
                        <td className="px-4 py-3 font-bold text-[#0F1E3C]">{Number(p.metros).toFixed(2)} m</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/60">{fmtR(p.precoCobrado)}</td>
                        <td className="px-4 py-3 text-[#0F1E3C]/50 text-xs">{fmtR(custo)}</td>
                        <td className="px-4 py-3">
                          {mgm != null ? (
                            <span className={`text-sm font-bold ${mgm >= 40 ? "text-emerald-600" : mgm >= 20 ? "text-amber-600" : "text-red-600"}`}>
                              {mgm.toFixed(1)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => excluir(p.id)} className="text-[#0F1E3C]/20 hover:text-red-400 transition-colors text-xs">
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
