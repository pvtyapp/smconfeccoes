"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Printer, FlaskConical, TrendingDown, X, AlertTriangle, Info, ChevronDown, ChevronUp, RotateCcw } from "lucide-react"
import MetricCard from "@/components/cards/MetricCard"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"
import { fmtR, fmtQtd } from "@/lib/format"

// ─── Types ──────────────────────────────────────────────────────────────────────
type PeriodKey = "hoje" | "7d" | "30d" | "90d" | "range"

type Pedido = {
  id: number; data: string; cliente: string | null
  metros: number; precoCobrado: number | null; observacao: string | null
}

type InsumoSummary = {
  id: number; nome: string; unidade: string; grupo: string
  saldoAtual: number; alarmeQtd: number | null; lowStock: boolean
  custoUnitario: number | null
}

type PrinterRefil = {
  id: number
  impressoraId: number
  insumoId: number
  insumoNome: string
  unidade: string
  grupo: string
  quantidade: number
  custoTotal: number | null
  abertaEm: string
  metrosAtuais: number
  custoPorMetroAtual: number | null
  historico: Array<{
    id: number; metrosNoCiclo: number | null; custoPorMetro: number | null
    abertaEm: string; fechadaEm: string
  }>
}

type FilmBobina = {
  id: number
  impressoraId: number
  tamanhoM: number
  abertaEm: string
  metrosUsados: number
  metrosRestantes: number
  pctUsado: number
  obs: string | null
  historico: Array<{
    id: number; tamanhoM: number; metrosUsados: number; desperdicioM: number
    abertaEm: string; fechadaEm: string
  }>
}

type ImpressoraInsumo = { insumoId: number; nome: string; unidade: string; quantidade: number; custo: number | null }
type ImpressoraMetric = {
  impressoraId: number; metros: number; pedidos: number
  insumos: ImpressoraInsumo[]
  custoTotalInsumos: number | null
  custoPorMetro: number | null
}

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

  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [filmBobinas,    setFilmBobinas]    = useState<FilmBobina[]>([])
  const [filmAlertaM,    setFilmAlertaM]    = useState(80)
  const [filmTamanhoM,   setFilmTamanhoM]   = useState(100)
  const [filmTrocaImp,   setFilmTrocaImp]   = useState<number | null>(null)
  const [filmTrocaForm,  setFilmTrocaForm]  = useState({ tamanhoM: "100", obs: "" })
  const [filmTrocando,   setFilmTrocando]   = useState(false)
  const [filmHistOpen,   setFilmHistOpen]   = useState<number | null>(null)

  const [printerRefis,  setPrinterRefis]  = useState<PrinterRefil[]>([])
  const [refilImp,      setRefilImp]      = useState<number | null>(null)
  const [refilForm,     setRefilForm]     = useState({ insumoId: "", quantidade: "", obs: "" })
  const [refilSaving,   setRefilSaving]   = useState(false)
  const [refilError,    setRefilError]    = useState("")

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    data: todayBR(),
    cliente: "", metros: "", precoCobrado: "", observacao: "", impressoraId: "1",
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

  const loadFilm = useCallback(async () => {
    const r = await fetch("/api/dtf/film-bobinas")
    if (r.ok) setFilmBobinas(await r.json())
  }, [])

  const loadRefis = useCallback(async () => {
    const r = await fetch("/api/dtf/printer-refis")
    if (r.ok) setPrinterRefis(await r.json())
  }, [])

  useEffect(() => { loadRelatorio() }, [loadRelatorio])
  useEffect(() => { loadInsumos() },   [loadInsumos])
  useEffect(() => { loadFilm() },      [loadFilm])
  useEffect(() => { loadRefis() },     [loadRefis])
  useEffect(() => {
    fetch("/api/dtf/preco").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.precoMetro) setPrecoMetro(d.precoMetro)
    })
    fetch("/api/settings").then(r => r.ok ? r.json() : null).then((d: Record<string, string> | null) => {
      if (d?.dtf_num_impressoras)     setNumImpressoras(Number(d.dtf_num_impressoras) || 1)
      if (d?.dtf_film_alerta_m)       setFilmAlertaM(Number(d.dtf_film_alerta_m) || 80)
      if (d?.dtf_film_tamanho_padrao) setFilmTamanhoM(Number(d.dtf_film_tamanho_padrao) || 100)
    })
  }, [])

  async function salvar() {
    if (!form.data || !form.metros) return
    const impressoraId = numImpressoras > 1 && form.impressoraId
      ? parseInt(form.impressoraId)
      : numImpressoras === 1 ? 1 : null
    const r = await fetch("/api/dtf/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: form.data,
        cliente: form.cliente || null,
        metros: parseFloat(form.metros),
        precoCobrado: form.precoCobrado ? parseFloat(form.precoCobrado) : null,
        observacao: form.observacao || null,
        impressoraId,
      }),
    })
    if (r.ok) {
      setForm({ data: todayBR(), cliente: "", metros: "", precoCobrado: "", observacao: "", impressoraId: "1" })
      setShowForm(false)
      loadRelatorio()
      loadFilm()
      loadRefis()
    }
  }

  async function salvarRefil(impressoraId: number) {
    if (!refilForm.insumoId || !refilForm.quantidade) return
    setRefilSaving(true)
    setRefilError("")
    const r = await fetch("/api/dtf/printer-refis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        impressoraId,
        insumoId: parseInt(refilForm.insumoId),
        quantidade: parseFloat(refilForm.quantidade),
        obs: refilForm.obs || null,
      }),
    })
    setRefilSaving(false)
    if (r.ok) {
      setRefilImp(null)
      setRefilForm({ insumoId: "", quantidade: "", obs: "" })
      loadRefis()
      loadInsumos()
    } else {
      const d = await r.json()
      setRefilError(d.error ?? "Erro ao salvar")
    }
  }

  async function trocarBobina(impressoraId: number) {
    setFilmTrocando(true)
    await fetch("/api/dtf/film-bobinas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        impressoraId,
        tamanhoM: parseFloat(filmTrocaForm.tamanhoM) || 100,
        obs: filmTrocaForm.obs || null,
      }),
    })
    setFilmTrocaImp(null)
    setFilmTrocaForm({ tamanhoM: "100", obs: "" })
    setFilmTrocando(false)
    loadFilm()
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
          <div className="flex items-center gap-3">
            <div className="relative flex items-center gap-2 bg-white border border-[#0F1E3C]/10 rounded-xl px-3 py-1.5">
              <Printer size={12} className="text-[#0F1E3C]/40" />
              <label className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider whitespace-nowrap">Impressoras</label>
              <input
                type="number" min="1" step="1"
                value={numImpressoras}
                onChange={e => setNumImpressoras(Math.max(1, parseInt(e.target.value) || 1))}
                onBlur={e => {
                  const n = Math.max(1, parseInt(e.target.value) || 1)
                  fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dtf_num_impressoras: String(n) }),
                  })
                }}
                className="w-10 text-center text-sm font-bold text-[#0F1E3C] focus:outline-none bg-transparent"
              />
              <button
                onClick={() => setShowTooltip(v => !v)}
                className="text-[#0F1E3C]/25 hover:text-[#4361EE] transition-colors"
              >
                <Info size={11} />
              </button>
              {showTooltip && (
                <div ref={tooltipRef} className="absolute top-full right-0 mt-2 w-72 bg-[#0F1E3C] text-white text-[11px] rounded-xl px-4 py-3 shadow-xl z-50 leading-relaxed">
                  <p className="font-bold mb-1">Quantidade de impressoras ativas</p>
                  <p className="text-white/70">
                    Com mais de 1 impressora, o operador seleciona qual máquina está produzindo cada pedido no kanban. Com isso o sistema rastreia:
                  </p>
                  <ul className="mt-1.5 space-y-1 text-white/70 list-disc list-inside">
                    <li>Metros produzidos por impressora</li>
                    <li>Insumos consumidos por impressora</li>
                    <li>Custo/metro individual por impressora</li>
                  </ul>
                  <p className="mt-2 text-white/50 text-[10px]">Salva automaticamente ao sair do campo.</p>
                </div>
              )}
            </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(relatorio?.impressoras ?? []).map(imp => (
                <div key={imp.impressoraId} className="bg-white rounded-2xl border border-blue-200 px-4 py-4 space-y-3">
                  {/* Cabeçalho */}
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">
                      Impressora {imp.impressoraId}
                    </p>
                    <span className="text-[10px] text-[#0F1E3C]/30">{imp.pedidos} pedido{imp.pedidos !== 1 ? "s" : ""}</span>
                  </div>

                  {/* Metros + custo/m */}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10px] text-[#0F1E3C]/40">Metros produzidos</p>
                      <p className="text-xl font-black text-[#0F1E3C]">{Number(imp.metros).toFixed(2)} m</p>
                    </div>
                    {imp.custoPorMetro != null && (
                      <div className="text-right">
                        <p className="text-[10px] text-[#0F1E3C]/40">Custo/metro</p>
                        <p className="text-sm font-bold text-[#4361EE]">
                          R$ {imp.custoPorMetro.toFixed(4).replace(".", ",")}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Insumos */}
                  {imp.insumos.length > 0 && (
                    <div className="border-t border-[#0F1E3C]/6 pt-2 space-y-1">
                      <p className="text-[9px] font-bold text-[#0F1E3C]/30 uppercase tracking-widest mb-1">Insumos consumidos</p>
                      {imp.insumos.map(ins => (
                        <div key={ins.insumoId} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#0F1E3C]/60 font-medium">{ins.nome}</span>
                          <span className="text-[#0F1E3C]/50">
                            {fmtQtd(ins.quantidade, ins.unidade)}
                            {ins.custo != null && (
                              <span className="ml-1 text-[#0F1E3C]/35">
                                · R$ {ins.custo.toFixed(2).replace(".", ",")}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                      {imp.custoTotalInsumos != null && (
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#0F1E3C]/6 font-bold">
                          <span className="text-[#0F1E3C]/50">Total insumos</span>
                          <span className="text-[#0F1E3C]">R$ {imp.custoTotalInsumos.toFixed(2).replace(".", ",")}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {imp.insumos.length === 0 && (
                    <p className="text-[10px] text-[#0F1E3C]/25 italic">Nenhum insumo registrado nesta impressora.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Film Monitor ── */}
      {numImpressoras >= 1 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <RotateCcw size={14} className="text-[#7C3AED]" />
              <h2 className="text-xs font-bold text-[#7C3AED] uppercase tracking-widest">Film — Monitor por Impressora</h2>
            </div>
            <div className="flex items-center gap-4 bg-white border border-[#7C3AED]/15 rounded-xl px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#0F1E3C]/40">Bobina</span>
                <input
                  type="number" min="1" step="1"
                  value={filmTamanhoM}
                  onChange={e => setFilmTamanhoM(Math.max(1, parseInt(e.target.value) || 100))}
                  onBlur={e => {
                    const n = Math.max(1, parseInt(e.target.value) || 100)
                    fetch("/api/settings", {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ dtf_film_tamanho_padrao: String(n) }),
                    })
                  }}
                  className="w-12 text-center text-xs font-bold text-[#7C3AED] focus:outline-none bg-transparent"
                />
                <span className="text-[10px] text-[#0F1E3C]/30">m</span>
              </div>
              <div className="w-px h-4 bg-[#0F1E3C]/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#0F1E3C]/40">Alerta em</span>
                <input
                  type="number" min="1" step="1"
                  value={filmAlertaM}
                  onChange={e => setFilmAlertaM(Math.max(1, parseInt(e.target.value) || 80))}
                  onBlur={e => {
                    const n = Math.max(1, parseInt(e.target.value) || 80)
                    fetch("/api/settings", {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ dtf_film_alerta_m: String(n) }),
                    })
                  }}
                  className="w-12 text-center text-xs font-bold text-[#7C3AED] focus:outline-none bg-transparent"
                />
                <span className="text-[10px] text-[#0F1E3C]/30">m</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filmBobinas.map(b => {
              const isAlert    = b.metrosUsados >= filmAlertaM
              const isCritical = b.metrosUsados >= (Number(b.tamanhoM) * 0.90)
              const barColor   = isCritical ? "bg-red-500" : isAlert ? "bg-amber-400" : "bg-emerald-500"
              const cardBorder = isCritical ? "border-red-200 bg-red-50/40" : isAlert ? "border-amber-200 bg-amber-50/30" : "border-[#0F1E3C]/8 bg-white"
              const ultimoDesp = b.historico[0]?.desperdicioM

              return (
                <div key={b.id} className={`rounded-2xl border p-4 space-y-3 ${cardBorder}`}>
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Printer size={12} className={isCritical ? "text-red-500" : isAlert ? "text-amber-500" : "text-[#7C3AED]"} />
                      <span className="text-xs font-bold text-[#0F1E3C]">Impressora {b.impressoraId}</span>
                      {isAlert && (
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${isCritical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {isCritical ? "CRÍTICO" : "ATENÇÃO"}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setFilmTrocaImp(b.impressoraId); setFilmTrocaForm({ tamanhoM: String(b.tamanhoM), obs: "" }) }}
                      className="text-[10px] font-bold text-[#7C3AED] hover:underline"
                    >
                      Trocar bobina
                    </button>
                  </div>

                  {/* Barra de progresso */}
                  <div>
                    <div className="h-2.5 w-full bg-[#0F1E3C]/8 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${Math.min(100, b.pctUsado)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[11px] font-bold text-[#0F1E3C]">
                        {Number(b.metrosUsados).toFixed(2)} m usados
                      </span>
                      <span className={`text-[11px] font-bold ${isCritical ? "text-red-600" : isAlert ? "text-amber-600" : "text-[#0F1E3C]/50"}`}>
                        {Number(b.metrosRestantes).toFixed(2)} m restantes
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-[10px] text-[#0F1E3C]/30">
                        Bobina: {Number(b.tamanhoM).toFixed(0)} m
                        {ultimoDesp != null && ` · Último desp.: ${Number(ultimoDesp).toFixed(1)} m`}
                      </p>
                      <p className="text-[10px] font-bold text-[#0F1E3C]/40">
                        {b.pctUsado.toFixed(1)}% usada
                      </p>
                    </div>
                  </div>

                  {/* Form: Trocar bobina */}
                  {filmTrocaImp === b.impressoraId && (
                    <div className="border-t border-[#7C3AED]/15 pt-3 space-y-2">
                      <p className="text-[10px] font-bold text-[#7C3AED] uppercase tracking-wider">Nova Bobina</p>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Tamanho (m)</label>
                          <input
                            type="number" min="1" step="1"
                            value={filmTrocaForm.tamanhoM}
                            onChange={e => setFilmTrocaForm(f => ({ ...f, tamanhoM: e.target.value }))}
                            className="w-full border border-[#7C3AED]/20 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"
                          />
                        </div>
                        <div className="flex-[2]">
                          <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Obs</label>
                          <input
                            type="text" placeholder="Fornecedor, lote..."
                            value={filmTrocaForm.obs}
                            onChange={e => setFilmTrocaForm(f => ({ ...f, obs: e.target.value }))}
                            className="w-full border border-[#7C3AED]/20 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => trocarBobina(b.impressoraId)}
                          disabled={filmTrocando}
                          className="bg-[#7C3AED] text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-[#6D28D9] transition-colors disabled:opacity-50"
                        >
                          {filmTrocando ? "Salvando..." : "Confirmar troca"}
                        </button>
                        <button onClick={() => setFilmTrocaImp(null)} className="text-xs text-[#0F1E3C]/40 hover:text-[#0F1E3C]">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Histórico accordion */}
                  {b.historico.length > 0 && (
                    <div className="border-t border-[#0F1E3C]/6 pt-2">
                      <button
                        onClick={() => setFilmHistOpen(filmHistOpen === b.id ? null : b.id)}
                        className="flex items-center gap-1 text-[10px] text-[#0F1E3C]/35 hover:text-[#0F1E3C]/60 transition-colors"
                      >
                        {filmHistOpen === b.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        {b.historico.length} bobina{b.historico.length !== 1 ? "s" : ""} anteriores
                      </button>
                      {filmHistOpen === b.id && (
                        <div className="mt-2 space-y-1">
                          {b.historico.slice(0, 6).map(h => (
                            <div key={h.id} className="flex items-center justify-between text-[10px] text-[#0F1E3C]/50 py-1 border-b border-[#0F1E3C]/5 last:border-0">
                              <span>{new Date(h.fechadaEm).toLocaleDateString("pt-BR")}</span>
                              <span>{Number(h.metrosUsados).toFixed(2)} m usados</span>
                              <span className={Number(h.desperdicioM) > 5 ? "text-red-500 font-bold" : "text-[#0F1E3C]/40"}>
                                -{Number(h.desperdicioM).toFixed(2)} m perdidos
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Inicializar impressoras sem bobina */}
          {Array.from({ length: numImpressoras }, (_, i) => i + 1)
            .filter(n => !filmBobinas.some(b => b.impressoraId === n))
            .length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: numImpressoras }, (_, i) => i + 1)
                .filter(n => !filmBobinas.some(b => b.impressoraId === n))
                .map(n => (
                  <button key={n} onClick={() => { setFilmTrocaImp(n); setFilmTrocaForm({ tamanhoM: "100", obs: "" }) }}
                    className="text-xs font-semibold text-[#7C3AED] border border-[#7C3AED]/30 px-3 py-1.5 rounded-xl hover:bg-[#7C3AED]/5 transition-colors">
                    + Instalar bobina na Impressora {n}
                  </button>
                ))}
            </div>
          )}

          {/* Form de instalação para impressoras sem bobina ativa */}
          {filmTrocaImp !== null && !filmBobinas.some(b => b.impressoraId === filmTrocaImp) && (
            <div className="bg-white border border-[#7C3AED]/20 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-bold text-[#7C3AED]">Instalar bobina na Impressora {filmTrocaImp}</p>
              <div className="flex gap-3">
                <div>
                  <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Tamanho (m)</label>
                  <input type="number" min="1" value={filmTrocaForm.tamanhoM}
                    onChange={e => setFilmTrocaForm(f => ({ ...f, tamanhoM: e.target.value }))}
                    className="w-24 border border-[#7C3AED]/20 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"/>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Obs</label>
                  <input type="text" placeholder="Fornecedor, lote..." value={filmTrocaForm.obs}
                    onChange={e => setFilmTrocaForm(f => ({ ...f, obs: e.target.value }))}
                    className="w-full border border-[#7C3AED]/20 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"/>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => trocarBobina(filmTrocaImp!)} disabled={filmTrocando}
                  className="bg-[#7C3AED] text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-[#6D28D9] disabled:opacity-50 transition-colors">
                  {filmTrocando ? "Salvando..." : "Instalar"}
                </button>
                <button onClick={() => setFilmTrocaImp(null)} className="text-xs text-[#0F1E3C]/40">Cancelar</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Monitor de Tintas & Poliamida ── */}
      {(() => {
        const insumoOptions = insumos.filter(i => i.grupo.toLowerCase() !== "film")
        if (insumoOptions.length === 0) return null
        return (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-[#E85D04]" />
              <h2 className="text-xs font-bold text-[#E85D04] uppercase tracking-widest">Tintas & Poliamida — Monitor por Impressora</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: numImpressoras }, (_, i) => i + 1).map(imp => {
                const refisImp = printerRefis.filter(r => r.impressoraId === imp)
                const isOpen   = refilImp === imp

                return (
                  <div key={imp} className="bg-white border border-orange-100 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FlaskConical size={12} className="text-[#E85D04]" />
                        <span className="text-xs font-bold text-[#0F1E3C]">Impressora {imp}</span>
                      </div>
                      <button
                        onClick={() => {
                          setRefilImp(isOpen ? null : imp)
                          setRefilForm({ insumoId: "", quantidade: "", obs: "" })
                          setRefilError("")
                        }}
                        className="text-[10px] font-bold text-[#E85D04] hover:underline"
                      >
                        {isOpen ? "Cancelar" : "+ Novo Refil"}
                      </button>
                    </div>

                    {refisImp.length === 0 && !isOpen ? (
                      <p className="text-[10px] text-[#0F1E3C]/25 italic">Nenhum refil ativo.</p>
                    ) : (
                      <div className="space-y-2">
                        {refisImp.map(r => {
                          const cpm = r.custoPorMetroAtual
                          return (
                            <div key={r.id} className="border border-gray-100 rounded-xl px-3 py-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-[#0F1E3C]">{r.insumoNome}</span>
                                <span className="text-[10px] text-gray-400">{fmtQtd(r.quantidade, r.unidade)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#0F1E3C]/40">
                                  {Number(r.metrosAtuais).toFixed(2)} m impresso
                                </span>
                                <span className={`text-[10px] font-bold font-mono ${cpm != null ? "text-[#E85D04]" : "text-gray-300"}`}>
                                  {cpm != null ? `R$ ${cpm.toFixed(4).replace(".", ",")}/m` : "aguardando metros"}
                                </span>
                              </div>
                              {r.historico.length > 0 && (
                                <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-50">
                                  Último ciclo: {Number(r.historico[0].metrosNoCiclo ?? 0).toFixed(1)} m
                                  {r.historico[0].custoPorMetro != null && (
                                    <span className="font-mono ml-1">
                                      · R$ {Number(r.historico[0].custoPorMetro).toFixed(4).replace(".", ",")}/m
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {isOpen && (
                      <div className="border-t border-orange-100 pt-3 space-y-2">
                        <p className="text-[10px] font-bold text-[#E85D04] uppercase tracking-wider">Novo Refil — Impressora {imp}</p>
                        <div>
                          <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Insumo *</label>
                          <select value={refilForm.insumoId}
                            onChange={e => setRefilForm(f => ({ ...f, insumoId: e.target.value }))}
                            className="w-full border border-orange-100 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200/50 bg-white text-[#0F1E3C]">
                            <option value="">— Selecione —</option>
                            {insumoOptions.map(o => (
                              <option key={o.id} value={String(o.id)}>{o.nome} ({o.unidade})</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Quantidade *</label>
                            <input type="number" step="0.001" min="0" placeholder="0,000"
                              value={refilForm.quantidade}
                              onChange={e => setRefilForm(f => ({ ...f, quantidade: e.target.value }))}
                              className="w-full border border-orange-100 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200/50"
                            />
                          </div>
                          {(() => {
                            const ins = insumos.find(i => String(i.id) === refilForm.insumoId)
                            const qtd = parseFloat(refilForm.quantidade)
                            if (!ins || !refilForm.insumoId) return null
                            if (ins.custoUnitario == null) return (
                              <p className="text-[10px] text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
                                Sem compras cadastradas para este insumo — custo não calculado
                              </p>
                            )
                            const custo = !isNaN(qtd) && qtd > 0 ? qtd * ins.custoUnitario : null
                            return (
                              <p className="text-[10px] text-[#0F1E3C]/50 bg-orange-50 px-3 py-1.5 rounded-lg">
                                Custo estimado:{" "}
                                <span className="font-bold text-[#E85D04]">
                                  {custo != null ? `R$ ${custo.toFixed(2).replace(".", ",")}` : "—"}
                                </span>
                                <span className="text-[#0F1E3C]/30 ml-1">
                                  ({ins.custoUnitario != null ? `R$ ${ins.custoUnitario.toFixed(4).replace(".", ",")}/${ins.unidade}` : ""} — média ponderada)
                                </span>
                              </p>
                            )
                          })()}
                        </div>
                        <div>
                          <label className="text-[10px] text-[#0F1E3C]/40 mb-1 block">Obs</label>
                          <input type="text" placeholder="Opcional"
                            value={refilForm.obs}
                            onChange={e => setRefilForm(f => ({ ...f, obs: e.target.value }))}
                            className="w-full border border-orange-100 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200/50"
                          />
                        </div>
                        {refilError && (
                          <p className="text-[10px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{refilError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => salvarRefil(imp)}
                            disabled={refilSaving || !refilForm.insumoId || !refilForm.quantidade}
                            className="bg-[#E85D04] text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-[#D14D00] transition-colors disabled:opacity-50"
                          >
                            {refilSaving ? "Salvando..." : "Confirmar Refil"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })()}

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
                  {ins.unidade === "metro"
                    ? `${parseFloat((ins.saldoAtual / filmTamanhoM).toFixed(2))} bobina${ins.saldoAtual / filmTamanhoM !== 1 ? "s" : ""}`
                    : fmtQtd(ins.saldoAtual, ins.unidade)}
                </p>
                {ins.unidade === "metro" && (
                  <p className={`text-[10px] mt-0.5 opacity-40 ${ins.lowStock ? "text-red-600" : clr.text}`}>
                    {parseFloat(Number(ins.saldoAtual).toFixed(1))} m no total
                  </p>
                )}
                {(() => {
                  const cpm = relatorio?.insumos.find(r => r.id === ins.id)?.custoPorMetroAtual
                  return cpm != null ? (
                    <p className={`text-xs mt-2 opacity-60 ${ins.lowStock ? "text-red-600" : clr.text}`}>
                      R$ {Number(cpm).toFixed(4).replace(".", ",")} / m impresso
                    </p>
                  ) : (
                    <p className={`text-xs mt-2 opacity-40 ${ins.lowStock ? "text-red-600" : clr.text}`}>
                      Sem custo cadastrado
                    </p>
                  )
                })()}
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
            <div className={`grid gap-3 ${numImpressoras > 1 ? "grid-cols-2 md:grid-cols-6" : "grid-cols-2 md:grid-cols-5"}`}>
              <div>
                <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Data *</label>
                <input type="date" value={form.data}
                  onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>
              {numImpressoras > 1 && (
                <div>
                  <label className="text-xs text-[#0F1E3C]/40 mb-1 block">Impressora *</label>
                  <div className="flex gap-1">
                    {Array.from({ length: numImpressoras }, (_, i) => String(i + 1)).map(n => (
                      <button key={n} type="button"
                        onClick={() => setForm(f => ({ ...f, impressoraId: n }))}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                          form.impressoraId === n
                            ? "bg-[#4361EE] text-white border-[#4361EE]"
                            : "bg-white text-[#0F1E3C]/50 border-gray-200 hover:border-[#4361EE]/40"
                        }`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
