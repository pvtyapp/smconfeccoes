"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, TrendingDown, AlertTriangle, ChevronDown, ChevronUp, Trash2, Bell, Settings, X, History } from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"

type Entrada = {
  id: number
  quantidade: number
  custoTotal: number | null
  data: string
  observacao: string | null
}

type Saida = {
  id: number
  quantidade: number
  data: string
  observacao: string | null
}

type PeriodKey = "1d" | "7d" | "15d" | "30d" | "60d" | "range"

type HistoricoRow = {
  id: number
  tipo: "entrada" | "saida"
  insumo_id: number
  insumo_nome: string
  grupo: string
  unidade: string
  quantidade: number
  custo_total: number | null
  data: string
  observacao: string | null
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "1d",    label: "Hoje" },
  { key: "7d",    label: "7d"   },
  { key: "15d",   label: "15d"  },
  { key: "30d",   label: "30d"  },
  { key: "60d",   label: "60d"  },
  { key: "range", label: "Período" },
]

function getPeriodDates(key: PeriodKey, rs: string, re: string): [string, string] {
  const t = todayBR()
  switch (key) {
    case "1d":    return [t, t]
    case "7d":    return [subDaysBR(6),  t]
    case "15d":   return [subDaysBR(14), t]
    case "30d":   return [subDaysBR(29), t]
    case "60d":   return [subDaysBR(59), t]
    case "range": return [rs, re]
  }
}

type Insumo = {
  id: number
  nome: string
  unidade: string
  grupo: string
  alarmeQtd: number | null
  diasAlarme: number | null
  saldoAtual: number
  consumoMedioPorMetro: number | null
  diasRestantes: number | null
  lowStock: boolean
  entradas: Entrada[]
  saidas: Saida[]
}

const GROUP_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Tinta:     { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"   },
  Film:      { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  Poliamida: { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200"  },
}
function groupColor(grupo: string) {
  return GROUP_COLOR[grupo] ?? { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" }
}

function fmtData(s: string) {
  return new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR")
}
function fmtQtd(v: number, unidade: string) {
  return `${parseFloat(Number(v).toFixed(3))} ${unidade}`
}
function fmtR(v: number | null | undefined) {
  if (v == null) return null
  return `R$ ${Number(v).toFixed(2).replace(".", ",")}`
}
function fmtCpm(v: number | null | undefined, unidade: string) {
  if (v == null) return "—"
  const n = Number(v)
  const decimals = unidade.toLowerCase() === "metro" ? 3 : 4
  return `${parseFloat(n.toFixed(decimals))} ${unidade}/m impresso`
}

function getToday() { return todayBR() }

const UNIDADES = ["litro", "metro", "kg", "g", "ml", "unidade"]

const novoInsumoInit = { nome: "", unidade: "litro", grupo: "", novoGrupo: "" }

export default function DTFInsumosPage() {
  const [insumos,   setInsumos]   = useState<Insumo[]>([])
  const [loading,   setLoading]   = useState(true)
  const [migrated,  setMigrated]  = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [error,     setError]     = useState("")

  const [expanded,     setExpanded]     = useState<number[]>([])
  const [showEntrada,  setShowEntrada]  = useState<number | null>(null)
  const [showSaida,    setShowSaida]    = useState<number | null>(null)
  const [showAlarme,   setShowAlarme]   = useState<number | null>(null)
  const [savingAlarme, setSavingAlarme] = useState(false)
  const [showNovoForm, setShowNovoForm] = useState(false)
  const [novoForm,     setNovoForm]     = useState(novoInsumoInit)
  const [savingNovo,   setSavingNovo]   = useState(false)

  const [entradaForm, setEntradaForm] = useState({ quantidade: "", custoTotal: "", data: getToday(), observacao: "", bobinas: "", metrosPorBobina: "" })
  const [saidaForm,   setSaidaForm]   = useState({ quantidade: "", data: getToday(), observacao: "" })
  const [saidaError,  setSaidaError]  = useState("")
  const [alarmeForm,  setAlarmeForm]  = useState("")

  // Histórico global
  const [histPeriod,     setHistPeriod]     = useState<PeriodKey>("30d")
  const [histRangeStart, setHistRangeStart] = useState("")
  const [histRangeEnd,   setHistRangeEnd]   = useState("")
  const [historico,      setHistorico]      = useState<HistoricoRow[]>([])
  const [histLoading,    setHistLoading]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetch("/api/dtf/insumos")
      if (r.ok) {
        setInsumos(await r.json())
        setMigrated(true)
      } else {
        const d = await r.json()
        if (d.error?.includes("does not exist") || d.error?.includes("column")) {
          setMigrated(false)
        } else {
          setError(d.error ?? "Erro ao carregar insumos")
          setMigrated(true)
        }
      }
    } catch {
      setError("Erro de conexão")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadHistorico = useCallback(async () => {
    if (histPeriod === "range" && (!histRangeStart || !histRangeEnd)) return
    const [from, to] = getPeriodDates(histPeriod, histRangeStart, histRangeEnd)
    setHistLoading(true)
    const r = await fetch(`/api/dtf/insumos/historico?from=${from}&to=${to}`)
    if (r.ok) setHistorico(await r.json())
    setHistLoading(false)
  }, [histPeriod, histRangeStart, histRangeEnd])

  useEffect(() => { if (migrated) loadHistorico() }, [migrated, loadHistorico])

  async function migrate() {
    setMigrating(true)
    const r = await fetch("/api/dtf/insumos/migrate", { method: "POST" })
    if (r.ok) { setMigrated(true); await load() }
    else setError("Falha na migração")
    setMigrating(false)
  }

  // Grupos únicos existentes para o dropdown
  const gruposExistentes = [...new Set(insumos.map(i => i.grupo))].sort()

  async function criarInsumo() {
    if (!novoForm.nome.trim() || !novoForm.unidade.trim()) return
    const grupo = novoForm.grupo === "__novo__"
      ? (novoForm.novoGrupo.trim() || novoForm.nome.trim())
      : (novoForm.grupo.trim() || novoForm.nome.trim())
    if (novoForm.grupo === "__novo__" && !novoForm.novoGrupo.trim()) return
    setSavingNovo(true)
    const r = await fetch("/api/dtf/insumos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: novoForm.nome, unidade: novoForm.unidade.toLowerCase().trim(), grupo }),
    })
    if (r.ok) { setNovoForm(novoInsumoInit); await load(); setShowNovoForm(false) }
    else { const d = await r.json(); setError(d.error ?? "Erro ao criar") }
    setSavingNovo(false)
  }

  async function deletarInsumo(ins: Insumo) {
    const temDados = ins.entradas.length > 0 || ins.saidas.length > 0
    const msg = temDados
      ? `Deletar "${ins.nome}"?\n\nISTO REMOVE TODAS as entradas e saídas deste insumo. Não pode ser desfeito.`
      : `Deletar "${ins.nome}"?`
    if (!confirm(msg)) return
    await fetch(`/api/dtf/insumos/${ins.id}`, { method: "DELETE" })
    load(); loadHistorico()
  }

  function toggleExpand(id: number) {
    setExpanded(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  }

  function openEntrada(id: number) {
    setShowEntrada(id); setShowSaida(null); setShowAlarme(null)
    setEntradaForm({ quantidade: "", custoTotal: "", data: getToday(), observacao: "", bobinas: "", metrosPorBobina: "" })
  }
  function openSaida(id: number) {
    setShowSaida(id); setShowEntrada(null); setShowAlarme(null)
    setSaidaForm({ quantidade: "", data: getToday(), observacao: "" })
    setSaidaError("")
  }
  function openAlarme(ins: Insumo) {
    setShowAlarme(ins.id); setShowEntrada(null); setShowSaida(null)
    setAlarmeForm(ins.alarmeQtd != null ? String(ins.alarmeQtd) : "")
  }

  async function salvarEntrada(insumoId: number, unidade: string) {
    const isMetro = unidade.toLowerCase() === "metro"
    if (isMetro) {
      if (!entradaForm.bobinas || !entradaForm.metrosPorBobina || !entradaForm.data) return
    } else {
      if (!entradaForm.quantidade || !entradaForm.data) return
    }

    const bobinas        = parseFloat(entradaForm.bobinas)
    const metrosPorBobina = parseFloat(entradaForm.metrosPorBobina)
    const quantidade     = isMetro ? bobinas * metrosPorBobina : parseFloat(entradaForm.quantidade)
    const custoUnit      = entradaForm.custoTotal ? parseFloat(entradaForm.custoTotal) : null
    const custoTotal     = custoUnit != null ? custoUnit * (isMetro ? bobinas : parseFloat(entradaForm.quantidade)) : null

    const r = await fetch("/api/dtf/insumos/entradas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insumoId, quantidade, custoTotal, data: entradaForm.data, observacao: entradaForm.observacao || null }),
    })
    if (r.ok) { setShowEntrada(null); load(); loadHistorico() }
    else { const d = await r.json(); setError(d.error ?? "Erro ao salvar") }
  }

  async function salvarSaida(insumoId: number) {
    if (!saidaForm.quantidade || !saidaForm.data) return
    setSaidaError("")
    const r = await fetch("/api/dtf/insumos/saidas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        insumoId,
        quantidade: parseFloat(saidaForm.quantidade),
        data:       saidaForm.data,
        observacao: saidaForm.observacao || null,
      }),
    })
    if (r.ok) { setShowSaida(null); setSaidaError(""); load(); loadHistorico() }
    else { const d = await r.json(); setSaidaError(d.error ?? "Erro ao salvar") }
  }

  async function salvarAlarme(insumoId: number, clear = false) {
    setSavingAlarme(true)
    await fetch(`/api/dtf/insumos/${insumoId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarmeQtd: clear ? null : (alarmeForm ? parseFloat(alarmeForm) : null) }),
    })
    setShowAlarme(null); load()
    setSavingAlarme(false)
  }

  async function deletarEntrada(id: number) {
    if (!confirm("Remover esta entrada?")) return
    await fetch(`/api/dtf/insumos/entradas/${id}`, { method: "DELETE" })
    load(); loadHistorico()
  }

  async function deletarSaida(id: number) {
    if (!confirm("Remover este registro de uso?")) return
    await fetch(`/api/dtf/insumos/saidas/${id}`, { method: "DELETE" })
    load(); loadHistorico()
  }

  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>

  if (!migrated) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4">
        <p className="text-sm text-[#0F1E3C]/60">Configure o módulo de estoque de insumos antes de usar.</p>
        <button onClick={migrate} disabled={migrating}
          className="bg-[#4361EE] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3451d1] transition-colors disabled:opacity-50">
          {migrating ? "Configurando..." : "Configurar Módulo de Insumos"}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  // Agrupar insumos por grupo
  const grupos = gruposExistentes.length > 0 ? gruposExistentes : []
  const insumosPorGrupo = grupos.reduce<Record<string, Insumo[]>>((acc, g) => {
    acc[g] = insumos.filter(i => i.grupo === g)
    return acc
  }, {})

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F1E3C]">Insumos DTF</h1>
          <p className="text-sm text-gray-400 mt-0.5">Estoque, entradas, baixas e consumo por metro</p>
        </div>
        <button
          onClick={() => { setShowNovoForm(v => !v); setNovoForm(novoInsumoInit) }}
          className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          {showNovoForm ? <X size={14} /> : <Plus size={14} />}
          {showNovoForm ? "Cancelar" : "Novo Insumo"}
        </button>
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {/* Formulário novo insumo */}
      {showNovoForm && (
        <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl shadow-sm p-5 space-y-4">
          <p className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Novo Insumo</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Nome */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Nome *</label>
              <input
                type="text"
                placeholder="Ex: Tinta Preta"
                value={novoForm.nome}
                onChange={e => setNovoForm(f => ({ ...f, nome: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
              />
            </div>

            {/* Unidade */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Unidade de medida *</label>
              <select
                value={novoForm.unidade}
                onChange={e => setNovoForm(f => ({ ...f, unidade: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 bg-white"
              >
                {UNIDADES.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                {novoForm.unidade === "metro" ? "Film: usa lógica de bobinas na entrada" : ""}
              </p>
            </div>

            {/* Grupo */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Grupo</label>
              <select
                value={novoForm.grupo}
                onChange={e => setNovoForm(f => ({ ...f, grupo: e.target.value, novoGrupo: "" }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 bg-white"
              >
                <option value="">— Sem grupo (usa o nome) —</option>
                {gruposExistentes.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
                <option value="__novo__">+ Criar novo grupo</option>
              </select>
              {novoForm.grupo === "__novo__" && (
                <input
                  type="text"
                  autoFocus
                  placeholder="Nome do novo grupo"
                  value={novoForm.novoGrupo}
                  onChange={e => setNovoForm(f => ({ ...f, novoGrupo: e.target.value }))}
                  className="w-full mt-2 border border-[#4361EE]/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
              )}
              <p className="text-[10px] text-gray-400 mt-1">Insumos do mesmo grupo aparecem juntos na tela.</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={criarInsumo}
              disabled={savingNovo || !novoForm.nome.trim() || (novoForm.grupo === "__novo__" && !novoForm.novoGrupo.trim())}
              className="bg-[#4361EE] text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-[#3451d1] transition-colors disabled:opacity-50"
            >
              {savingNovo ? "Criando..." : "Criar Insumo"}
            </button>
            <button onClick={() => setShowNovoForm(false)}
              className="text-gray-400 px-3 py-2 rounded-xl text-xs hover:bg-gray-100 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Grupos */}
      <div className="space-y-8">
        {grupos.map(grupo => {
          const clr       = groupColor(grupo)
          const lista     = insumosPorGrupo[grupo] ?? []
          const anyLow    = lista.some(i => i.lowStock)

          return (
            <div key={grupo}>
              {/* Cabeçalho do grupo */}
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${clr.bg} ${clr.border} ${clr.text}`}>
                  {grupo}
                </span>
                {anyLow && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={9} /> Estoque baixo
                  </span>
                )}
                <span className="text-[10px] text-gray-300">{lista.length} {lista.length === 1 ? "variação" : "variações"}</span>
              </div>

              <div className="space-y-4">
                {lista.map(ins => {
                  const isExpand = expanded.includes(ins.id)
                  const history: Array<{ date: string; tipo: "entrada" | "saida"; id: number; quantidade: number; custoTotal?: number | null; observacao?: string | null }> = [
                    ...ins.entradas.map(e => ({ date: e.data, tipo: "entrada" as const, id: e.id, quantidade: e.quantidade, custoTotal: e.custoTotal, observacao: e.observacao })),
                    ...ins.saidas.map(s  => ({ date: s.data, tipo: "saida"  as const, id: s.id, quantidade: s.quantidade, observacao: s.observacao })),
                  ].sort((a, b) => b.date.localeCompare(a.date))

                  return (
                    <div key={ins.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">

                      {/* Header do insumo */}
                      <div className={`flex items-center justify-between px-5 py-3 border-b border-gray-50 ${ins.lowStock ? "bg-red-50/60" : ""}`}>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${clr.bg} ${clr.border} ${clr.text}`}>
                            {ins.nome}
                          </span>
                          <span className="text-xs text-gray-400">{ins.unidade}</span>
                          {ins.lowStock && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                              <AlertTriangle size={9} /> Estoque baixo
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openAlarme(ins)} title="Configurar alarme"
                            className={`p-1.5 rounded-lg transition-colors ${ins.alarmeQtd != null ? "text-amber-500 hover:bg-amber-50" : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"}`}>
                            <Bell size={13} />
                          </button>
                          <button onClick={() => openEntrada(ins.id)}
                            className="flex items-center gap-1 text-xs bg-emerald-600 text-white px-2.5 py-1.5 rounded-xl font-semibold hover:bg-emerald-700 transition-colors">
                            <Plus size={11} /> Entrada
                          </button>
                          <button onClick={() => openSaida(ins.id)}
                            className="flex items-center gap-1 text-xs bg-[#4361EE] text-white px-2.5 py-1.5 rounded-xl font-semibold hover:bg-[#3451d1] transition-colors">
                            <TrendingDown size={11} /> Uso
                          </button>
                          {history.length > 0 && (
                            <button onClick={() => toggleExpand(ins.id)} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                              {isExpand ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                          <button onClick={() => deletarInsumo(ins)} className="text-gray-200 hover:text-red-400 transition-colors p-1" title="Deletar insumo">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Saldo atual</p>
                          <p className={`text-lg font-black ${ins.lowStock ? "text-red-600" : "text-[#0F1E3C]"}`}>
                            {fmtQtd(ins.saldoAtual, ins.unidade)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Consumo médio</p>
                          <p className="text-sm font-bold text-[#4361EE]">{fmtCpm(ins.consumoMedioPorMetro, ins.unidade)}</p>
                          <p className="text-[10px] text-gray-400">por metro impresso</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Duração estimada</p>
                          <p className={`text-sm font-bold ${ins.diasRestantes != null && ins.diasRestantes < 14 ? "text-red-500" : "text-[#0F1E3C]"}`}>
                            {ins.diasRestantes != null ? `~${ins.diasRestantes} dias` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Alarme</p>
                          {ins.alarmeQtd != null ? (
                            <>
                              <p className="text-sm font-bold text-amber-600">{fmtQtd(ins.alarmeQtd, ins.unidade)}</p>
                              {ins.diasAlarme != null && <p className="text-[10px] text-gray-400">≈ {ins.diasAlarme} dias</p>}
                            </>
                          ) : (
                            <button onClick={() => openAlarme(ins)} className="text-xs text-gray-300 hover:text-amber-500 transition-colors flex items-center gap-1">
                              <Settings size={10} /> Configurar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Form: Alarme */}
                      {showAlarme === ins.id && (
                        <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 space-y-3">
                          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Alarme de Reposição</p>
                          <div className="flex items-center gap-3">
                            <input type="number" step="0.001" min="0" value={alarmeForm}
                              onChange={e => setAlarmeForm(e.target.value)}
                              placeholder={`Ex: 1.000 ${ins.unidade}`}
                              className="w-44 border border-amber-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                            />
                            <span className="text-xs text-amber-600">{ins.unidade}</span>
                            <button onClick={() => salvarAlarme(ins.id)} disabled={savingAlarme}
                              className="bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50">
                              Salvar
                            </button>
                            {ins.alarmeQtd != null && (
                              <button onClick={() => salvarAlarme(ins.id, true)}
                                className="text-xs text-gray-400 hover:text-red-400 transition-colors">
                                Remover
                              </button>
                            )}
                            <button onClick={() => setShowAlarme(null)} className="text-xs text-gray-400">Cancelar</button>
                          </div>
                        </div>
                      )}

                      {/* Form: Entrada */}
                      {showEntrada === ins.id && (() => {
                        const isMetro    = ins.unidade === "metro"
                        const bobinas    = parseFloat(entradaForm.bobinas)
                        const mPorB      = parseFloat(entradaForm.metrosPorBobina)
                        const custoUnit  = parseFloat(entradaForm.custoTotal)
                        const totalMetros = isMetro && !isNaN(bobinas) && !isNaN(mPorB) ? bobinas * mPorB : null
                        const totalCusto  = isMetro
                          ? (!isNaN(bobinas) && !isNaN(custoUnit) ? bobinas * custoUnit : null)
                          : (entradaForm.quantidade && entradaForm.custoTotal ? parseFloat(entradaForm.quantidade) * custoUnit : null)

                        return (
                          <div className="px-5 py-3 bg-emerald-50 border-t border-emerald-100 space-y-3">
                            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Entrada de Estoque</p>
                            <div className={`grid gap-3 ${isMetro ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-4"}`}>
                              <div>
                                <label className="text-xs text-gray-500 mb-1 block">Data *</label>
                                <input type="date" value={entradaForm.data}
                                  onChange={e => setEntradaForm(f => ({ ...f, data: e.target.value }))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                />
                              </div>

                              {isMetro ? (
                                <>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Bobinas *</label>
                                    <input type="number" step="1" min="1" placeholder="Ex: 2" value={entradaForm.bobinas}
                                      onChange={e => setEntradaForm(f => ({ ...f, bobinas: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Metros/bobina *</label>
                                    <input type="number" step="0.01" min="0" placeholder="Ex: 100" value={entradaForm.metrosPorBobina}
                                      onChange={e => setEntradaForm(f => ({ ...f, metrosPorBobina: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                    {totalMetros != null && (
                                      <p className="text-[10px] text-emerald-600 mt-1 font-semibold">Total: {totalMetros.toFixed(2)} m</p>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Custo/bobina (R$)</label>
                                    <input type="number" step="0.01" min="0" placeholder="Opcional" value={entradaForm.custoTotal}
                                      onChange={e => setEntradaForm(f => ({ ...f, custoTotal: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                    {totalCusto != null && (
                                      <p className="text-[10px] text-emerald-600 mt-1 font-semibold">Total: R$ {totalCusto.toFixed(2).replace(".", ",")}</p>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Qtd ({ins.unidade}) *</label>
                                    <input type="number" step="0.001" min="0" placeholder="0,000" value={entradaForm.quantidade}
                                      onChange={e => setEntradaForm(f => ({ ...f, quantidade: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Custo unitário (R$)</label>
                                    <input type="number" step="0.01" min="0" placeholder="Opcional" value={entradaForm.custoTotal}
                                      onChange={e => setEntradaForm(f => ({ ...f, custoTotal: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                    {totalCusto != null && (
                                      <p className="text-[10px] text-emerald-600 mt-1 font-semibold">Total: R$ {totalCusto.toFixed(2).replace(".", ",")}</p>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Observação</label>
                                    <input type="text" placeholder="Fornecedor, NF..." value={entradaForm.observacao}
                                      onChange={e => setEntradaForm(f => ({ ...f, observacao: e.target.value }))}
                                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                    />
                                  </div>
                                </>
                              )}
                            </div>

                            {isMetro && (
                              <div>
                                <label className="text-xs text-gray-500 mb-1 block">Observação</label>
                                <input type="text" placeholder="Fornecedor, NF..." value={entradaForm.observacao}
                                  onChange={e => setEntradaForm(f => ({ ...f, observacao: e.target.value }))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                />
                              </div>
                            )}

                            <div className="flex gap-2">
                              <button onClick={() => salvarEntrada(ins.id, ins.unidade)}
                                className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors">
                                Salvar Entrada
                              </button>
                              <button onClick={() => setShowEntrada(null)} className="text-gray-400 px-3 py-2 rounded-xl text-xs hover:bg-gray-100 transition-colors">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Form: Saída */}
                      {showSaida === ins.id && (
                        <div className="px-5 py-3 bg-[#4361EE]/5 border-t border-[#4361EE]/10 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-[#4361EE] uppercase tracking-wider">Registrar Uso</p>
                            <p className="text-[10px] text-[#0F1E3C]/40">
                              Disponível: <span className="font-bold text-[#0F1E3C]">{fmtQtd(ins.saldoAtual, ins.unidade)}</span>
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">Data *</label>
                              <input type="date" value={saidaForm.data}
                                onChange={e => setSaidaForm(f => ({ ...f, data: e.target.value }))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">
                                Qtd usada ({ins.unidade}) * <span className="text-[#0F1E3C]/30">máx {fmtQtd(ins.saldoAtual, ins.unidade)}</span>
                              </label>
                              <input
                                type="number" step="0.001" min="0"
                                max={ins.saldoAtual}
                                placeholder="0,000"
                                value={saidaForm.quantidade}
                                onChange={e => {
                                  const v = e.target.value
                                  const n = parseFloat(v)
                                  if (!isNaN(n) && n > ins.saldoAtual) return
                                  setSaidaForm(f => ({ ...f, quantidade: v }))
                                  setSaidaError("")
                                }}
                                className={`w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${
                                  saidaError ? "border-red-300 focus:ring-red-300/30" : "border-gray-200 focus:ring-[#4361EE]/20"
                                }`}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">Observação</label>
                              <input type="text" placeholder="Período, motivo..." value={saidaForm.observacao}
                                onChange={e => setSaidaForm(f => ({ ...f, observacao: e.target.value }))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                              />
                            </div>
                          </div>
                          {saidaError && (
                            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{saidaError}</p>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => salvarSaida(ins.id)}
                              className="bg-[#4361EE] text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-[#3451d1] transition-colors">
                              Salvar
                            </button>
                            <button onClick={() => { setShowSaida(null); setSaidaError("") }} className="text-gray-400 px-3 py-2 rounded-xl text-xs hover:bg-gray-100 transition-colors">
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Histórico */}
                      {isExpand && history.length > 0 && (
                        <div className="border-t border-gray-50">
                          <p className="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Histórico</p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 text-gray-400 uppercase tracking-wider text-[10px]">
                                <th className="px-5 py-2 text-left">Data</th>
                                <th className="px-5 py-2 text-left">Tipo</th>
                                <th className="px-5 py-2 text-right">Quantidade</th>
                                <th className="px-5 py-2 text-right">Custo</th>
                                <th className="px-5 py-2 text-left">Observação</th>
                                <th className="px-5 py-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {history.map(h => (
                                <tr key={`${h.tipo}-${h.id}`} className="hover:bg-gray-50/50">
                                  <td className="px-5 py-2 text-gray-500">{fmtData(h.date)}</td>
                                  <td className="px-5 py-2">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      h.tipo === "entrada" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                                    }`}>
                                      {h.tipo === "entrada" ? "Entrada" : "Uso"}
                                    </span>
                                  </td>
                                  <td className={`px-5 py-2 text-right font-bold ${h.tipo === "entrada" ? "text-emerald-600" : "text-orange-600"}`}>
                                    {h.tipo === "entrada" ? "+" : "-"}{fmtQtd(h.quantidade, ins.unidade)}
                                  </td>
                                  <td className="px-5 py-2 text-right text-gray-500">
                                    {h.tipo === "entrada" && h.custoTotal != null ? fmtR(h.custoTotal) ?? "—" : "—"}
                                  </td>
                                  <td className="px-5 py-2 text-gray-400 max-w-[180px] truncate">{h.observacao || "—"}</td>
                                  <td className="px-5 py-2 text-right">
                                    <button
                                      onClick={() => h.tipo === "entrada" ? deletarEntrada(h.id) : deletarSaida(h.id)}
                                      className="text-gray-200 hover:text-red-400 transition-colors"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {insumos.length === 0 && (
        <div className="text-center py-16 text-[#0F1E3C]/25 space-y-2">
          <p className="text-sm">Nenhum insumo cadastrado.</p>
          <p className="text-xs">Clique em "Novo Insumo" para começar.</p>
        </div>
      )}

      {/* ── Histórico global ── */}
      {migrated && insumos.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-gray-100">

          {/* Header histórico */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <History size={14} className="text-[#0F1E3C]/35" />
              <h2 className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Histórico de Movimentações</h2>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
                {PERIOD_OPTIONS.map(opt => (
                  <button key={opt.key} onClick={() => setHistPeriod(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      histPeriod === opt.key
                        ? "bg-[#4361EE] text-white shadow-sm"
                        : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {histPeriod === "range" && (
                <div className="flex items-center gap-2">
                  <input type="date" value={histRangeStart} onChange={e => setHistRangeStart(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                  <span className="text-xs text-[#0F1E3C]/40">até</span>
                  <input type="date" value={histRangeEnd} onChange={e => setHistRangeEnd(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                </div>
              )}
            </div>
          </div>

          {/* Tabela histórico */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {histLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : historico.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#0F1E3C]/30">Nenhuma movimentação no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[#0F1E3C]/40 uppercase tracking-wider text-[10px]">
                      <th className="px-5 py-3 text-left">Data</th>
                      <th className="px-5 py-3 text-left">Grupo</th>
                      <th className="px-5 py-3 text-left">Insumo</th>
                      <th className="px-5 py-3 text-left">Tipo</th>
                      <th className="px-5 py-3 text-right">Quantidade</th>
                      <th className="px-5 py-3 text-right">Custo</th>
                      <th className="px-5 py-3 text-left">Observação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {historico.map((h, i) => (
                      <tr key={`${h.tipo}-${h.id}`} className={`hover:bg-gray-50/60 transition-colors ${i % 2 === 1 ? "bg-gray-50/30" : ""}`}>
                        <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{fmtData(h.data)}</td>
                        <td className="px-5 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${groupColor(h.grupo).bg} ${groupColor(h.grupo).border} ${groupColor(h.grupo).text}`}>
                            {h.grupo}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 font-medium text-[#0F1E3C]">{h.insumo_nome}</td>
                        <td className="px-5 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            h.tipo === "entrada" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                          }`}>
                            {h.tipo === "entrada" ? "Entrada" : "Uso"}
                          </span>
                        </td>
                        <td className={`px-5 py-2.5 text-right font-bold whitespace-nowrap ${h.tipo === "entrada" ? "text-emerald-600" : "text-orange-600"}`}>
                          {h.tipo === "entrada" ? "+" : "-"}{fmtQtd(h.quantidade, h.unidade)}
                        </td>
                        <td className="px-5 py-2.5 text-right text-gray-500 whitespace-nowrap">
                          {h.tipo === "entrada" && h.custo_total != null
                            ? `R$ ${Number(h.custo_total).toFixed(2).replace(".", ",")}`
                            : "—"}
                        </td>
                        <td className="px-5 py-2.5 text-gray-400 max-w-[200px] truncate">{h.observacao || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
