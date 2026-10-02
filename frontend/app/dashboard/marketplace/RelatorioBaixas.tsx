"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Printer, Download, Store, CalendarDays, Package, Layers, ClipboardList, ChevronRight, Loader2, RefreshCw } from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR, fmtDateOnlyBR, TZ } from "@/lib/tz"
import { colorSwatch } from "@/lib/colorSwatch"
import { sizeCompare } from "@/lib/sizeOrder"
import { printWhenReady } from "@/components/print/print-utils"
import RelatorioPrintSheet, { type ProdutoGrade } from "./RelatorioPrintSheet"

// Relatório de baixas: filtro de loja + período → quantidades unificadas por
// produto (grade cor × tamanho) e, embaixo, as baixas que formam esse total.

export type Loja = { id: number; nome: string; createdAt: string }
type Separation = {
  id: number; number: string; origin: string; lojaId: number | null; lojaNome: string
  totalItems: number; totalPieces: number; createdAt: string; canceledAt: string | null
}
type ConsRow = { productId: string; productName: string; color: string; size: string; qty: number }

// Separações de antes da tela de Lojas gravaram um desses valores em `origin`.
export const ORIGIN_LABEL: Record<string, string> = { shopee: "Shopee", mercado_livre: "Mercado Livre", manual: "Manual" }
export const lojaLabel = (nome: string) => ORIGIN_LABEL[nome] ?? nome

type PresetKey = "hoje" | "ontem" | "7d" | "30d" | "mes_atual" | "mes_passado" | "range"
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes_atual", label: "Mês atual" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "range", label: "Período" },
]

function presetDates(key: PresetKey, rs: string, re: string): [string, string] | null {
  const t = todayBR()
  const [y, m] = t.split("-").map(Number)
  const pad = (n: number) => String(n).padStart(2, "0")
  switch (key) {
    case "hoje": return [t, t]
    case "ontem": { const d = subDaysBR(1); return [d, d] }
    case "7d": return [subDaysBR(6), t]
    case "30d": return [subDaysBR(29), t]
    case "mes_atual": return [`${y}-${pad(m)}-01`, t]
    case "mes_passado": {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
      return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`]
    }
    case "range": return rs && re ? (rs <= re ? [rs, re] : [re, rs]) : null
  }
}

const horaBR = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

export function montarGrade(rows: ConsRow[]): ProdutoGrade[] {
  const byProd = new Map<string, ConsRow[]>()
  for (const r of rows) {
    if (!byProd.has(r.productId)) byProd.set(r.productId, [])
    byProd.get(r.productId)!.push(r)
  }
  return [...byProd.values()].map(rs => {
    const sizes = [...new Set(rs.map(r => r.size))].sort(sizeCompare)
    const colors = [...new Set(rs.map(r => r.color))].sort((a, b) => a.localeCompare(b))
    const cell = new Map(rs.map(r => [`${r.color}|${r.size}`, r.qty]))
    const linhas = colors.map(color => {
      const qtys = sizes.map(s => cell.get(`${color}|${s}`) ?? 0)
      return { color, qtys, total: qtys.reduce((a, b) => a + b, 0) }
    })
    const totaisTam = sizes.map((_, i) => linhas.reduce((s, l) => s + l.qtys[i], 0))
    return { productName: rs[0].productName, sizes, linhas, totaisTam, total: totaisTam.reduce((a, b) => a + b, 0) }
  }).sort((a, b) => a.productName.localeCompare(b.productName))
}

export default function RelatorioBaixas({ lojas, reloadKey, onOpenDetail }: {
  lojas: Loja[]; reloadKey: number; onOpenDetail: (id: number) => void
}) {
  const [preset, setPreset] = useState<PresetKey>("hoje")
  const [rangeStart, setRangeStart] = useState(subDaysBR(6))
  const [rangeEnd, setRangeEnd] = useState(todayBR())
  const [loja, setLoja] = useState<string>("all")
  const [data, setData] = useState<{ separations: Separation[]; consolidated: ConsRow[]; hasLegacy: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [printing, setPrinting] = useState(false)

  const dates = presetDates(preset, rangeStart, rangeEnd)
  const from = dates?.[0], to = dates?.[1]

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true); setError("")
    try {
      const res = await fetch(`/api/marketplace/history?from=${from}&to=${to}&loja=${loja}`)
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? "Erro ao carregar"); return }
      setData(d)
    } catch {
      setError("Falha de rede ao carregar")
    } finally { setLoading(false) }
  }, [from, to, loja])
  useEffect(() => { load() }, [load, reloadKey])

  const grade = useMemo(() => montarGrade(data?.consolidated ?? []), [data])
  const ativas = (data?.separations ?? []).filter(s => !s.canceledAt)
  const canceladas = (data?.separations.length ?? 0) - ativas.length
  const totalPecas = grade.reduce((s, g) => s + g.total, 0)
  const variantes = data?.consolidated.length ?? 0

  const lojaOpcoes = [
    { key: "all", label: "Todas" },
    ...lojas.map(l => ({ key: String(l.id), label: l.nome })),
    ...(data?.hasLegacy ? [{ key: "none", label: "Antigas (sem loja)" }] : []),
  ]
  const lojaNomeFiltro = lojaOpcoes.find(o => o.key === loja)?.label ?? "Todas"
  const periodoTxt = from && to ? (from === to ? fmtDateOnlyBR(from) : `${fmtDateOnlyBR(from)} a ${fmtDateOnlyBR(to)}`) : ""

  function exportarCsv() {
    if (!data || !from || !to) return
    const linhas = ["Produto;Cor;Tamanho;Quantidade"]
    for (const g of grade) for (const l of g.linhas) g.sizes.forEach((s, i) => {
      if (l.qtys[i] > 0) linhas.push([g.productName, l.color, s, String(l.qtys[i])].map(v => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(";"))
    })
    linhas.push(`TOTAL;;;${totalPecas}`)
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `baixas-marketplace-${lojaNomeFiltro.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${from}-a-${to}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays size={14} className="text-[#0F1E3C]/30" />
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
            {PRESETS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setPreset(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${preset === key ? "bg-[#4361EE] text-white shadow-sm" : "text-[#0F1E3C]/55 hover:text-[#0F1E3C] hover:bg-white/70"}`}>
                {label}
              </button>
            ))}
          </div>
          {preset === "range" && (
            <div className="flex items-center gap-2">
              <input type="date" value={rangeStart} max={todayBR()} onChange={e => setRangeStart(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
              <span className="text-xs text-[#0F1E3C]/40">até</span>
              <input type="date" value={rangeEnd} max={todayBR()} onChange={e => setRangeEnd(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Store size={14} className="text-[#0F1E3C]/30 mr-0.5" />
          {lojaOpcoes.map(o => (
            <button key={o.key} type="button" onClick={() => setLoja(o.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${loja === o.key ? "bg-[#0F1E3C] text-white border-[#0F1E3C]" : "text-[#0F1E3C]/55 border-[#0F1E3C]/10 hover:bg-[#0F1E3C]/5"}`}>
              {o.label}
            </button>
          ))}
          <button type="button" onClick={load} title="Atualizar" className="ml-auto p-2 rounded-lg text-[#0F1E3C]/35 hover:text-[#4361EE] hover:bg-[#4361EE]/8">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          [ClipboardList, "Baixas", ativas.length, canceladas ? `${canceladas} cancelada${canceladas > 1 ? "s" : ""} fora da conta` : periodoTxt],
          [Package, "Peças", totalPecas, lojaNomeFiltro === "Todas" ? "todas as lojas" : lojaNomeFiltro],
          [Layers, "Produtos", grade.length, `${variantes} combinações cor/tamanho`],
          [Store, "Lojas", new Set(ativas.map(s => s.lojaNome)).size, "com baixa no período"],
        ] as const).map(([Icon, titulo, valor, sub]) => (
          <div key={titulo} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 flex items-center gap-1.5"><Icon size={12} /> {titulo}</p>
            <p className="text-2xl font-black text-[#0F1E3C] tabular-nums mt-1">{valor}</p>
            <p className="text-[11px] text-[#0F1E3C]/40 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Quantidades unificadas */}
      <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h2 className="font-black text-[#0F1E3C]">Quantidades unificadas</h2>
            <p className="text-xs text-[#0F1E3C]/45 mt-0.5">Soma de todas as baixas ativas · {lojaNomeFiltro} · {periodoTxt}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportarCsv} disabled={!grade.length}
              className="flex items-center gap-1.5 border border-[#0F1E3C]/12 text-[#0F1E3C] text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#F4F6FB] disabled:opacity-40">
              <Download size={13} /> Planilha
            </button>
            <button type="button" onClick={() => { setPrinting(true); printWhenReady() }} disabled={!grade.length}
              className="flex items-center gap-1.5 bg-[#0F1E3C] text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#1B2A4A] disabled:opacity-40">
              <Printer size={13} /> Imprimir
            </button>
          </div>
        </div>

        {loading && !data ? (
          <p className="text-xs text-[#0F1E3C]/40 px-5 py-10 text-center">Carregando…</p>
        ) : grade.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Package size={28} strokeWidth={1.3} className="mx-auto text-[#0F1E3C]/15 mb-2" />
            <p className="text-sm text-[#0F1E3C]/45">Nenhuma baixa nesse período{loja !== "all" ? " pra essa loja" : ""}.</p>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {grade.map(g => (
              <div key={g.productName} className="border border-[#0F1E3C]/8 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#F4F6FB]">
                  <p className="text-sm font-black text-[#0F1E3C]">{g.productName}</p>
                  <p className="text-sm font-black text-[#4361EE] tabular-nums">{g.total} pç</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">
                        <th className="text-left px-4 py-2 font-bold">Cor</th>
                        {g.sizes.map(s => <th key={s} className="px-2 py-2 text-center w-12">{s || "U"}</th>)}
                        <th className="px-4 py-2 text-right w-16">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.linhas.map(l => (
                        <tr key={l.color} className="border-t border-[#0F1E3C]/5">
                          <td className="px-4 py-2 font-semibold text-[#0F1E3C] whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-3 h-3 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]" style={{ background: colorSwatch(l.color) }} />
                              {l.color}
                            </span>
                          </td>
                          {l.qtys.map((q, i) => (
                            <td key={i} className={`px-2 py-2 text-center tabular-nums ${q ? "font-black text-[#0F1E3C]" : "text-[#0F1E3C]/15"}`}>{q || "·"}</td>
                          ))}
                          <td className="px-4 py-2 text-right font-black text-[#0F1E3C] tabular-nums">{l.total}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[#0F1E3C]/10 bg-[#F9FAFB] text-[#0F1E3C]/60">
                        <td className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider">Total</td>
                        {g.totaisTam.map((q, i) => <td key={i} className="px-2 py-2 text-center font-bold tabular-nums">{q || "·"}</td>)}
                        <td className="px-4 py-2 text-right font-black text-[#4361EE] tabular-nums">{g.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Baixas do período */}
      <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="font-black text-[#0F1E3C]">Baixas do período</h2>
          <p className="text-xs text-[#0F1E3C]/45 mt-0.5">
            {data?.separations.length ?? 0} baixa{(data?.separations.length ?? 0) === 1 ? "" : "s"} · clique numa linha pra ver, editar, cancelar ou reimprimir
          </p>
        </div>
        {(data?.separations.length ?? 0) === 0 ? (
          <p className="text-xs text-[#0F1E3C]/40 px-5 py-8 text-center">{loading ? "Carregando…" : "Nenhuma baixa nesse filtro."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 bg-[#F9FAFB]">
                  <th className="text-left px-5 py-2.5">Número</th>
                  <th className="text-left px-5 py-2.5">Data</th>
                  <th className="text-left px-5 py-2.5">Loja</th>
                  <th className="text-right px-5 py-2.5">Itens</th>
                  <th className="text-right px-5 py-2.5">Peças</th>
                  <th className="text-left px-5 py-2.5">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data!.separations.map(s => (
                  <tr key={s.id} onClick={() => onOpenDetail(s.id)}
                    className={`border-t border-[#0F1E3C]/5 cursor-pointer hover:bg-[#F4F6FB] transition-colors ${s.canceledAt ? "opacity-50" : ""}`}>
                    <td className="px-5 py-3 font-bold text-[#0F1E3C]">{s.number}</td>
                    <td className="px-5 py-3 text-[#0F1E3C]/55 tabular-nums whitespace-nowrap">{fmtDateBR(s.createdAt)} <span className="text-[#0F1E3C]/35">{horaBR(s.createdAt)}</span></td>
                    <td className="px-5 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/60">{lojaLabel(s.lojaNome)}</span></td>
                    <td className="px-5 py-3 text-right tabular-nums text-[#0F1E3C]/70">{s.totalItems}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold text-[#0F1E3C]">{s.totalPieces} pç</td>
                    <td className="px-5 py-3">
                      {s.canceledAt
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">cancelada</span>
                        : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">ativa</span>}
                    </td>
                    <td className="px-3 py-3 text-[#0F1E3C]/25"><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {printing && (
        <RelatorioPrintSheet grade={grade} loja={lojaNomeFiltro} periodo={periodoTxt}
          baixas={ativas.map(s => s.number)} totalPecas={totalPecas} onDone={() => setPrinting(false)} />
      )}
    </div>
  )
}
