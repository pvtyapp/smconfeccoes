"use client"

import { useState, useEffect, useCallback } from "react"
import { BarChart2, TrendingDown, Printer, Users, FileDown } from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR, fmtDateOnlyBR } from "@/lib/tz"
import { fmtR, fmtQtd } from "@/lib/format"
import { printWhenReady } from "@/components/print/print-utils"
import DTFRelatorioPrintSheet from "./DTFRelatorioPrintSheet"

type Pedido = {
  id: number; data: string; concludedAt: string; cliente: string | null
  metros: number; metrosFinais: number | null
  precoCobrado: number | null; observacao: string | null
  dueDate: string | null; paidAt: string | null
}

// À vista/prazo — mesma regra usada no Relatório de Vendas.
function pagamento(p: { dueDate: string | null; paidAt: string | null }): { label: string; cls: string } {
  const isPrazo = !!p.dueDate
  const isPago  = !!p.paidAt
  if (isPrazo && !isPago) return { label: `Prazo · ${fmtDateOnlyBR(p.dueDate)}`, cls: "text-amber-700 bg-amber-50" }
  if (isPrazo && isPago)  return { label: "Prazo · Pago",                        cls: "text-blue-700 bg-blue-50"  }
  return { label: "À vista", cls: "text-green-700 bg-green-50" }
}

type CicloFechado = {
  id: number; abertoEm: string; fechadoEm: string
  custo: number; metrosNoPeriodo: number; custoPorMetro: number
  metrosInicial?: number | null
  desperdicio?: number | null
  pctDesperdicio?: number | null
}

type InsumoRelatorio = {
  id: number; nome: string; unidade: string
  custoPorMetroAtual: number | null
  metrosAcumulados: number
  ciclosFechados: CicloFechado[]
  loteAtivo: { abertoEm: string; custo: number } | null
  pctDesperdicioMedio?: number | null
}

type FilmEficiencia = {
  impressoraId: number
  bobinas: number
  totalConsumedM: number
  totalProducedM: number
  totalWasteM: number
  desperdicoPct: number
  eficienciaPct: number
}

type ImpressoraInsumo = {
  insumoId: number; nome: string; unidade: string; quantidade: number; custo: number | null
}

type Impressora = {
  impressoraId: number
  metros: number
  pedidos: number
  insumos: ImpressoraInsumo[]
  custoTotalInsumos: number | null
  custoPorMetro: number | null
}

type TopCliente = {
  cliente: string
  pedidos: number
  metros: number
  receita: number
}

type Relatorio = {
  pedidos: Pedido[]
  totalMetros: number
  totalReceita: number
  insumos: InsumoRelatorio[]
  custoCombinado: number | null
  impressoras: Impressora[]
  filmEficiencia: FilmEficiencia[]
  topClientes: TopCliente[]
}

type PeriodoKey = "hoje" | "ontem" | "7d" | "30d" | "90d" | "tudo"

const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "hoje",  label: "Hoje"    },
  { key: "ontem", label: "Ontem"   },
  { key: "7d",    label: "7 dias"  },
  { key: "30d",   label: "30 dias" },
  { key: "90d",   label: "90 dias" },
  { key: "tudo",  label: "Tudo"    },
]

const PEDIDOS_PAGE_SIZE = 20

function calcRange(key: PeriodoKey): { from: string; to: string } | null {
  if (key === "tudo")  return null
  if (key === "hoje")  return { from: todayBR(), to: todayBR() }
  if (key === "ontem") { const d = subDaysBR(1); return { from: d, to: d } }
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90
  return { from: subDaysBR(days - 1), to: todayBR() }
}

function fmtCpm(v: number | null | undefined) {
  if (v == null) return "—"
  return `R$ ${Number(v).toFixed(4).replace(".", ",")}/m`
}
function fmtData(s: string) { return fmtDateBR(s) }
function fmtM(v: number | null | undefined) {
  if (v == null) return "—"
  return `${Number(v).toFixed(2)} m`
}

function wasteStyle(pct: number) {
  if (pct < 8)  return { card: "bg-emerald-50 border-emerald-100", label: "text-emerald-400", value: "text-emerald-700" }
  if (pct < 15) return { card: "bg-amber-50 border-amber-100",     label: "text-amber-400",   value: "text-amber-700"   }
  return               { card: "bg-red-50 border-red-100",         label: "text-red-400",     value: "text-red-700"     }
}

const INSUMO_COLOR: Record<string, string> = {
  Tinta:     "text-blue-600",
  Film:      "text-purple-600",
  Poliamida: "text-amber-600",
}

export default function DTFRelatorioPage() {
  const [periodo, setPeriodo] = useState<PeriodoKey>("30d")
  const [data, setData]       = useState<Relatorio | null>(null)
  const [loading, setLoading] = useState(true)
  const [pedidosPage, setPedidosPage] = useState(1)
  const [showPrint, setShowPrint] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setPedidosPage(1)
    const range = calcRange(periodo)
    const qs = range ? `?from=${range.from}&to=${range.to}` : ""
    const r = await fetch(`/api/dtf/relatorio${qs}`)
    if (r.ok) setData(await r.json())
    setLoading(false)
  }, [periodo])

  useEffect(() => { load() }, [load])

  function handleExtrairRelatorio() {
    setShowPrint(true)
    printWhenReady()
  }

  const range = calcRange(periodo)
  const periodoLabel = range
    ? `${fmtDateOnlyBR(range.from)} → ${fmtDateOnlyBR(range.to)}`
    : (PERIODOS.find(p => p.key === periodo)?.label ?? "")

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F1E3C]">Relatório DTF</h1>
          <p className="text-sm text-gray-400 mt-0.5">Consumo de insumos e performance de produção — só pedidos concluídos</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            {PERIODOS.map(p => (
              <button key={p.key} onClick={() => setPeriodo(p.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  periodo === p.key ? "bg-white text-[#0F1E3C] shadow-sm" : "text-gray-400 hover:text-gray-600"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {data && (
            <button
              onClick={handleExtrairRelatorio}
              className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              <FileDown size={14} /> Extrair Relatório
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-gray-400">Carregando...</div>
      ) : !data ? null : (
        <>
          {/* ── BLOCO 1: Volume + Monitor de Insumo ──
              Custo/m aqui é só indicador operacional (ciclo de consumo mais
              recente de film/tinta/poliamida) — nunca comparado contra receita.
              Margem real de DTF vive só no Relatório Financeiro, calculada a
              partir do custo cadastrado no produto "DTF 60cm". */}
          {(() => {
            const film = data.insumos.find(i => i.unidade === "metro")
            const precoMedioM = data.totalMetros > 0 ? data.totalReceita / data.totalMetros : null
            const ticketMedio = data.pedidos.length > 0 ? data.totalReceita / data.pedidos.length : null
            const metroMedio  = data.pedidos.length > 0 ? data.totalMetros  / data.pedidos.length : null

            const ws = film?.pctDesperdicioMedio != null
              ? wasteStyle(Number(film.pctDesperdicioMedio)) : null

            return (
              <div className="space-y-3">
                {/* Linha 1: volume */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Metros no período",  value: fmtM(data.totalMetros) },
                    { label: "Receita no período",  value: fmtR(data.totalReceita) },
                    { label: "Pedidos",             value: String(data.pedidos.length) },
                    { label: "Metro médio/pedido",  value: fmtM(metroMedio) },
                  ].map(s => (
                    <div key={s.label} className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
                      <p className="text-xs uppercase tracking-widest mb-1 text-gray-400">{s.label}</p>
                      <p className="text-2xl font-bold text-[#0F1E3C]">{s.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400">
                  Conta pedidos concluídos, pela data em que foram feitos — pedido criado à noite e fechado só de manhã continua no dia em que foi impresso.
                </p>

                {/* Linha 2: monitor de insumo (informativo) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-2xl p-4 border border-[#0F1E3C] bg-[#0F1E3C] shadow-sm">
                    <p className="text-xs uppercase tracking-widest mb-1 text-white/50">Custo/m insumos (monitor)</p>
                    <p className="text-2xl font-bold text-white">{fmtCpm(data.custoCombinado)}</p>
                  </div>
                  <div className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
                    <p className="text-xs uppercase tracking-widest mb-1 text-gray-400">Preço médio/m</p>
                    <p className="text-2xl font-bold text-[#0F1E3C]">{fmtCpm(precoMedioM)}</p>
                  </div>
                  <div className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
                    <p className="text-xs uppercase tracking-widest mb-1 text-gray-400">Ticket médio</p>
                    <p className="text-2xl font-bold text-[#0F1E3C]">{fmtR(ticketMedio)}</p>
                  </div>
                  {ws && film?.pctDesperdicioMedio != null ? (
                    <div className={`rounded-2xl p-4 border shadow-sm ${ws.card}`}>
                      <p className={`text-xs uppercase tracking-widest mb-1 ${ws.label}`}>Desperdício film</p>
                      <p className={`text-2xl font-bold ${ws.value}`}>{Number(film.pctDesperdicioMedio).toFixed(1)}%</p>
                      <p className={`text-[10px] mt-0.5 ${ws.label}`}>média ponderada</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
                      <p className="text-xs uppercase tracking-widest mb-1 text-gray-400">Desperdício film</p>
                      <p className="text-2xl font-bold text-gray-300">—</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── BLOCO 2: Performance por Impressora ── */}
          {(data.impressoras ?? []).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
                <Printer size={16} className="text-[#4361EE]" />
                <span className="font-semibold text-sm text-[#0F1E3C]">Performance por Impressora</span>
                <span className="text-[10px] text-gray-400">período selecionado</span>
              </div>
              <div className="divide-y divide-gray-50">
                {(data.impressoras ?? []).map((imp, idx) => {
                  const totalMetrosAll = (data.impressoras ?? []).reduce((s, i) => s + i.metros, 0)
                  const share = totalMetrosAll > 0 ? (imp.metros / totalMetrosAll) * 100 : 0
                  const globalCpm = data.custoCombinado
                  const impCpm = imp.custoPorMetro
                  const diffCpm = globalCpm && impCpm ? impCpm - globalCpm : null

                  return (
                    <div key={imp.impressoraId} className="px-5 py-4">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-white bg-[#0F1E3C] rounded-lg px-2 py-1">
                            Imp. {imp.impressoraId}
                          </span>
                          <span className="text-sm font-semibold text-[#0F1E3C]">{Number(imp.metros).toFixed(2)} m</span>
                          <span className="text-xs text-gray-400">{imp.pedidos} pedido{imp.pedidos !== 1 ? "s" : ""}</span>
                          <span className="text-xs text-gray-400">{share.toFixed(1)}% do volume</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {impCpm != null && (
                            <span className="text-sm font-mono font-semibold text-[#0F1E3C]">
                              {fmtCpm(impCpm)}
                            </span>
                          )}
                          {diffCpm != null && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              diffCpm > 0
                                ? "bg-red-50 text-red-600"
                                : diffCpm < 0
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-gray-50 text-gray-400"
                            }`}>
                              {diffCpm > 0 ? "+" : ""}{diffCpm.toFixed(4).replace(".", ",")} vs média
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Barra de share */}
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${share}%`,
                            backgroundColor: ["#4361EE", "#7B2FBE", "#E85D04", "#2EC4B6"][idx % 4],
                          }}
                        />
                      </div>

                      {/* Insumos breakdown */}
                      {imp.insumos.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {imp.insumos.map(ins => (
                            <span key={ins.insumoId} className="text-[10px] bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 text-gray-500">
                              {ins.nome}: {fmtQtd(ins.quantidade, ins.unidade)}
                              {ins.custo != null && ` · ${fmtR(ins.custo)}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── BLOCO 3: Top Clientes ── */}
          {(data.topClientes ?? []).filter(c => c.receita > 0).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
                <Users size={16} className="text-[#4361EE]" />
                <span className="font-semibold text-sm text-[#0F1E3C]">Top Clientes</span>
                <span className="text-[10px] text-gray-400">período selecionado</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Cliente</th>
                    <th className="px-5 py-3 text-right">Pedidos</th>
                    <th className="px-5 py-3 text-right">Metros</th>
                    <th className="px-5 py-3 text-right">Receita</th>
                    <th className="px-5 py-3 text-right">% total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data.topClientes ?? []).filter(c => c.receita > 0).map((c, i) => {
                    const pct = data.totalReceita > 0 ? (c.receita / data.totalReceita) * 100 : 0
                    return (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3 font-medium text-[#0F1E3C]">{c.cliente}</td>
                        <td className="px-5 py-3 text-right text-gray-500">{c.pedidos}</td>
                        <td className="px-5 py-3 text-right font-mono text-gray-700">{Number(c.metros).toFixed(2)} m</td>
                        <td className="px-5 py-3 text-right font-semibold text-[#0F1E3C]">{fmtR(c.receita)}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#4361EE] rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── BLOCO 4: Custo por Insumo ── */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
              <TrendingDown size={16} className="text-[#4361EE]" />
              <span className="font-semibold text-sm text-[#0F1E3C]">Custo por Insumo</span>
            </div>
            <div className="divide-y divide-gray-50">
              {data.insumos.map(ins => (
                <div key={ins.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-sm font-bold ${INSUMO_COLOR[ins.nome] || "text-gray-700"}`}>{ins.nome}</span>
                    <span className="text-lg font-bold text-[#0F1E3C]">{fmtCpm(ins.custoPorMetroAtual)}</span>
                  </div>
                  {ins.loteAtivo && (
                    <p className="text-xs text-gray-400 mb-2">
                      Lote ativo desde {fmtData(ins.loteAtivo.abertoEm)} · {fmtR(ins.loteAtivo.custo)} · {Number(ins.metrosAcumulados).toFixed(2)} m acumulados
                    </p>
                  )}
                  {ins.ciclosFechados.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-300 mb-1">Ciclos anteriores</p>
                      {ins.ciclosFechados.slice(0, 3).map(c => (
                        <div key={c.id} className="text-xs text-gray-400">
                          <div className="flex items-center justify-between">
                            <span>{fmtData(c.abertoEm)} → {fmtData(c.fechadoEm)}</span>
                            <span className="font-mono">{Number(c.metrosNoPeriodo).toFixed(2)} m · {fmtCpm(c.custoPorMetro)}</span>
                          </div>
                          {ins.unidade === "metro" && c.metrosInicial != null && c.desperdicio != null && (
                            <div className="flex items-center justify-between mt-0.5 pl-2 border-l-2 border-gray-100">
                              <span className="text-[10px] text-gray-300">
                                {Number(c.metrosNoPeriodo).toFixed(1)} m impressos / {Number(c.metrosInicial).toFixed(1)} m disponíveis
                              </span>
                              <span className={`text-[10px] font-semibold font-mono ${
                                (c.pctDesperdicio ?? 0) < 8 ? "text-emerald-500"
                                : (c.pctDesperdicio ?? 0) < 15 ? "text-amber-500"
                                : "text-red-500"
                              }`}>
                                {Number(c.desperdicio).toFixed(1)} m desperdiçados ({Number(c.pctDesperdicio).toFixed(1)}%)
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Eficiência de film por impressora (histórico completo) ── */}
          {(data.filmEficiencia ?? []).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
                <span className="text-sm font-bold text-[#0F1E3C]">Eficiência de Film — por Impressora</span>
                <span className="text-[10px] text-gray-400">(histórico completo de bobinas)</span>
              </div>
              <div className="divide-y divide-gray-50">
                {(data.filmEficiencia ?? []).map(ef => {
                  const ws = wasteStyle(ef.desperdicoPct)
                  return (
                    <div key={ef.impressoraId} className="px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Impressora</p>
                        <p className="text-sm font-bold text-[#0F1E3C]">{ef.impressoraId}</p>
                        <p className="text-[10px] text-gray-400">{ef.bobinas} bobina{ef.bobinas !== 1 ? "s" : ""}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Consumido</p>
                        <p className="text-sm font-semibold text-[#0F1E3C]">{Number(ef.totalConsumedM).toFixed(1)} m</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Produzido</p>
                        <p className="text-sm font-semibold text-[#0F1E3C]">{Number(ef.totalProducedM).toFixed(1)} m</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Desperdício</p>
                        <p className={`text-sm font-bold ${ws.value}`}>{Number(ef.totalWasteM).toFixed(1)} m</p>
                      </div>
                      <div className={`rounded-xl px-3 py-2 border text-center ${ws.card}`}>
                        <p className={`text-[10px] uppercase tracking-wider ${ws.label}`}>Eficiência</p>
                        <p className={`text-xl font-black ${ws.value}`}>{Number(ef.eficienciaPct).toFixed(1)}%</p>
                        <p className={`text-[9px] ${ws.label}`}>{Number(ef.desperdicoPct).toFixed(1)}% perdido</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Pedidos do período ── */}
          {data.pedidos.length > 0 && (() => {
            const totalPaginas = Math.max(1, Math.ceil(data.pedidos.length / PEDIDOS_PAGE_SIZE))
            const paginaAtual  = Math.min(pedidosPage, totalPaginas)
            const inicio       = (paginaAtual - 1) * PEDIDOS_PAGE_SIZE
            const pedidosPagina = data.pedidos.slice(inicio, inicio + PEDIDOS_PAGE_SIZE)

            return (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <BarChart2 size={16} className="text-[#4361EE]" />
                    <span className="font-semibold text-sm text-[#0F1E3C]">Pedidos no Período</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{data.pedidos.length} pedido{data.pedidos.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                        <th className="px-5 py-3 text-left">Data</th>
                        <th className="px-5 py-3 text-left">Cliente</th>
                        <th className="px-5 py-3 text-right">Metros</th>
                        <th className="px-5 py-3 text-center">Pagamento</th>
                        <th className="px-5 py-3 text-right">Preço cobrado</th>
                        <th className="px-5 py-3 text-right">Preço/m</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pedidosPagina.map(p => {
                        const metros = Number(p.metrosFinais ?? p.metros ?? 0)
                        const preco  = p.precoCobrado != null ? Number(p.precoCobrado) : null
                        const precoM = preco != null && metros > 0 ? preco / metros : null
                        const pag    = pagamento(p)

                        return (
                          <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-5 py-3 text-gray-700">{fmtDateOnlyBR(p.data)}</td>
                            <td className="px-5 py-3 text-gray-700">{p.cliente || <span className="text-gray-300">—</span>}</td>
                            <td className="px-5 py-3 text-right font-mono font-semibold text-[#0F1E3C]">{metros.toFixed(2)} m</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${pag.cls}`}>{pag.label}</span>
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700">{fmtR(preco)}</td>
                            <td className="px-5 py-3 text-right text-xs font-mono text-gray-500">{fmtCpm(precoM)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPaginas > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50">
                    <button
                      onClick={() => setPedidosPage(p => Math.max(1, p - 1))}
                      disabled={paginaAtual === 1}
                      className="text-xs font-semibold text-[#4361EE] disabled:text-gray-300 disabled:cursor-not-allowed hover:underline"
                    >
                      ← Anterior
                    </button>
                    <span className="text-xs text-gray-400">Página {paginaAtual} de {totalPaginas}</span>
                    <button
                      onClick={() => setPedidosPage(p => Math.min(totalPaginas, p + 1))}
                      disabled={paginaAtual === totalPaginas}
                      className="text-xs font-semibold text-[#4361EE] disabled:text-gray-300 disabled:cursor-not-allowed hover:underline"
                    >
                      Próxima →
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}

      {showPrint && data && (
        <DTFRelatorioPrintSheet
          pedidos={data.pedidos}
          topClientes={data.topClientes ?? []}
          totalMetros={data.totalMetros}
          totalReceita={data.totalReceita}
          periodoLabel={periodoLabel}
          onDone={() => setShowPrint(false)}
        />
      )}
    </div>
  )
}
