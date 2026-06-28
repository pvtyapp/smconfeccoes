"use client"

import { useState, useEffect, useCallback } from "react"
import { BarChart2, TrendingDown } from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"

type Pedido = {
  id: number; data: string; cliente: string | null
  metros: number; precoCobrado: number | null; observacao: string | null
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

type Relatorio = {
  pedidos: Pedido[]
  totalMetros: number
  totalReceita: number
  insumos: InsumoRelatorio[]
  custoCombinado: number | null
}

type PeriodoKey = "7d" | "30d" | "90d" | "tudo"

const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "7d",   label: "7 dias"  },
  { key: "30d",  label: "30 dias" },
  { key: "90d",  label: "90 dias" },
  { key: "tudo", label: "Tudo"    },
]

function calcRange(key: PeriodoKey): { from: string; to: string } | null {
  if (key === "tudo") return null
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90
  return { from: subDaysBR(days - 1), to: todayBR() }
}

function fmtR(v: number | null | undefined) {
  if (v == null) return "—"
  return `R$ ${Number(v).toFixed(2).replace(".", ",")}`
}
function fmtCpm(v: number | null | undefined) {
  if (v == null) return "—"
  return `R$ ${Number(v).toFixed(4).replace(".", ",")}/m`
}
function fmtData(s: string) { return fmtDateBR(s) }

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

  const load = useCallback(async () => {
    setLoading(true)
    const range = calcRange(periodo)
    const qs = range ? `?from=${range.from}&to=${range.to}` : ""
    const r = await fetch(`/api/dtf/relatorio${qs}`)
    if (r.ok) setData(await r.json())
    setLoading(false)
  }, [periodo])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F1E3C]">Relatório DTF</h1>
          <p className="text-sm text-gray-400 mt-0.5">Custo por metro e análise de produção</p>
        </div>
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
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-gray-400">Carregando...</div>
      ) : !data ? null : (
        <>
          {/* Stats topo */}
          {(() => {
            const film = data.insumos.find(i => i.unidade === "metro")
            const temDesp = film != null && film.pctDesperdicioMedio != null
            const cols = temDesp ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"
            const ws = temDesp ? wasteStyle(Number(film!.pctDesperdicioMedio)) : null
            return (
              <div className={`grid ${cols} gap-4`}>
                {[
                  { label: "Metros no período",    value: `${Number(data.totalMetros).toFixed(2)} m` },
                  { label: "Receita no período",   value: fmtR(data.totalReceita) },
                  { label: "Pedidos",              value: String(data.pedidos.length) },
                  { label: "Custo/metro combinado", value: fmtCpm(data.custoCombinado), highlight: true },
                ].map(s => (
                  <div key={s.label} className={`rounded-2xl p-4 border shadow-sm ${s.highlight ? "bg-[#0F1E3C] border-[#0F1E3C]" : "bg-white border-gray-100"}`}>
                    <p className={`text-xs uppercase tracking-widest mb-1 ${s.highlight ? "text-white/50" : "text-gray-400"}`}>{s.label}</p>
                    <p className={`text-2xl font-bold ${s.highlight ? "text-white" : "text-[#0F1E3C]"}`}>{s.value}</p>
                  </div>
                ))}
                {temDesp && ws && (
                  <div className={`rounded-2xl p-4 border shadow-sm ${ws.card}`}>
                    <p className={`text-xs uppercase tracking-widest mb-1 ${ws.label}`}>Desperdício Film</p>
                    <p className={`text-2xl font-bold ${ws.value}`}>
                      {Number(film!.pctDesperdicioMedio).toFixed(1)}%
                    </p>
                    <p className={`text-[10px] mt-0.5 ${ws.label}`}>média ponderada</p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Custo por insumo */}
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

          {/* Pedidos do período */}
          {data.pedidos.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
                <BarChart2 size={16} className="text-[#4361EE]" />
                <span className="font-semibold text-sm text-[#0F1E3C]">Pedidos no Período</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Data</th>
                    <th className="px-5 py-3 text-left">Cliente</th>
                    <th className="px-5 py-3 text-right">Metros</th>
                    <th className="px-5 py-3 text-right">Preço</th>
                    <th className="px-5 py-3 text-right">Custo est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.pedidos.map(p => {
                    const custo = data.custoCombinado ? Number(p.metros) * data.custoCombinado : null
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3 text-gray-700">{fmtData(p.data)}</td>
                        <td className="px-5 py-3 text-gray-700">{p.cliente || <span className="text-gray-300">—</span>}</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-[#0F1E3C]">{Number(p.metros).toFixed(2)} m</td>
                        <td className="px-5 py-3 text-right text-gray-700">{fmtR(p.precoCobrado)}</td>
                        <td className="px-5 py-3 text-right text-gray-500 text-xs">{fmtR(custo)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
