"use client"

import { useState, useEffect, useCallback } from "react"
import { Calculator, ChevronRight, Check, X, AlertCircle, Calendar, Package, Loader2 } from "lucide-react"
import { todayBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

// ─── Types ─────────────────────────────────────────────────────────────────────
type OpCost     = { id: string; name: string; category: string; monthlyValue: number; periodValue: number }
type SkuRow     = { size: string; weight: number; costPerPiece: number }
type OrderRow   = { id: number; number: string; productName: string; status: string; concludedAt: string; totalPieces: number }
type ProductRow = { productId: string; productName: string }

type Preview = {
  orders:          OrderRow[]
  orderCount:      number
  totalPieces:     number
  totalWeighted:   number
  operationalCosts: OpCost[]
  totalOperational: number
  periodDays:      number
  costPerWeightUnit: number
  skuBreakdown:    SkuRow[]
  productsAffected: ProductRow[]
}

type Closure = {
  id:                number
  periodStart:       string
  periodEnd:         string
  periodDays:        number
  orderCount:        number
  totalPieces:       number
  totalWeighted:     string
  totalOperational:  string
  costPerWeightUnit: string
  notes:             string | null
  createdAt:         string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s: string) {
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}
function todayISO() { return todayBR() }
function monthStart() {
  const [y, m] = todayBR().split("-")
  return `${y}-${m}-01`
}
function prevMonthRange(): [string, string] {
  const [y, m] = todayBR().split("-").map(Number)
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y
  const lastDay = new Date(prevY, prevM, 0).getDate()
  const mm = String(prevM).padStart(2, "0")
  return [`${prevY}-${mm}-01`, `${prevY}-${mm}-${String(lastDay).padStart(2, "0")}`]
}
function weekStart() {
  const t = todayBR()
  const d = new Date(t + "T12:00:00Z")
  const dow = d.getUTCDay()
  const diff = dow === 0 ? 6 : dow - 1
  const mon = new Date(d.getTime() - diff * 86_400_000)
  return mon.toISOString().slice(0, 10)
}

// ─── NovoFechamentoModal ────────────────────────────────────────────────────────
type Step = "periodo" | "preview" | "confirmando"

function NovoFechamentoModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep]       = useState<Step>("periodo")
  const [start, setStart]     = useState(monthStart())
  const [end, setEnd]         = useState(todayISO())
  const [notes, setNotes]     = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function applyPreset(preset: "semana" | "mes" | "mes_anterior") {
    if (preset === "semana") { setStart(weekStart()); setEnd(todayISO()) }
    else if (preset === "mes") { setStart(monthStart()); setEnd(todayISO()) }
    else { const [s, e] = prevMonthRange(); setStart(s); setEnd(e) }
  }

  async function handlePreview() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/cost-closures/preview?start=${start}&end=${end}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Erro ao carregar prévia"); return }
      setPreview(data)
      setStep("preview")
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    setStep("confirmando")
    try {
      const res = await fetch("/api/cost-closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: start, periodEnd: end, notes: notes || null }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Erro ao aplicar fechamento"); setStep("preview"); return }
      onSuccess()
    } catch {
      setError("Erro de conexão"); setStep("preview")
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
              Novo Fechamento de Período
            </h3>
            <div className="flex items-center gap-1 mt-2">
              {[
                { key: "periodo",    label: "Período"  },
                { key: "preview",    label: "Prévia"   },
                { key: "confirmando",label: "Aplicando"},
              ].map(({ key, label }, i) => {
                const steps: Step[] = ["periodo","preview","confirmando"]
                const idx = steps.indexOf(step)
                const cur = i === idx, done = i < idx
                return (
                  <div key={key} className="flex items-center gap-1">
                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                      cur ? "bg-[#4361EE] text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-[#0F1E3C]/6 text-[#0F1E3C]/30"
                    }`}>
                      {done ? <Check size={9}/> : <span>{i + 1}</span>} {label}
                    </div>
                    {i < 2 && <div className={`w-4 h-px ${done ? "bg-emerald-300" : "bg-[#0F1E3C]/10"}`}/>}
                  </div>
                )
              })}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center">
            <X size={15}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Período ── */}
          {step === "periodo" && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-3">Atalhos</p>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "Esta semana",    preset: "semana"       },
                    { label: "Este mês",       preset: "mes"          },
                    { label: "Mês anterior",   preset: "mes_anterior" },
                  ].map(({ label, preset }) => (
                    <button key={preset}
                      onClick={() => applyPreset(preset as "semana"|"mes"|"mes_anterior")}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:bg-[#4361EE] hover:text-white hover:border-[#4361EE] transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Início</label>
                  <input type="date" value={start} onChange={e => setStart(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Fim</label>
                  <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Observação (opcional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Ex: Fechamento maio 2026"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle size={14}/> {error}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Prévia ── */}
          {step === "preview" && preview && (
            <div className="space-y-5">

              {preview.orderCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[#0F1E3C]/30">
                  <Package size={32} className="mb-3 opacity-30"/>
                  <p className="text-sm font-semibold">Nenhuma ordem pendente neste período</p>
                  <p className="text-xs mt-1">Tente selecionar outro intervalo de datas</p>
                </div>
              ) : (
                <>
                  {/* Resumo */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Ordens",    value: preview.orderCount.toString() },
                      { label: "Peças",     value: preview.totalPieces.toString() },
                      { label: "Custo Op.", value: fmtR(preview.totalOperational) },
                    ].map(({ label, value }) => (
                      <div key={label} className="px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">{label}</p>
                        <p className="text-lg font-black text-[#0F1E3C] mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Custo por tamanho */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Custo operacional por tamanho</p>
                    <div className="rounded-xl border border-[#0F1E3C]/8 overflow-hidden">
                      <div className="grid grid-cols-3 px-4 py-2 bg-[#F9FAFB] border-b border-[#0F1E3C]/8">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Tamanho</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 text-center">Peso (kg)</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#4361EE] text-right">Custo/peça</span>
                      </div>
                      {preview.skuBreakdown.map(row => (
                        <div key={row.size} className="grid grid-cols-3 px-4 py-2.5 border-b border-[#0F1E3C]/4 last:border-0">
                          <span className="text-sm font-bold text-[#0F1E3C]">{row.size}</span>
                          <span className="text-sm text-[#0F1E3C]/60 text-center">{row.weight.toFixed(2)} kg</span>
                          <span className="text-sm font-bold text-[#4361EE] text-right">{fmtR(row.costPerPiece)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ordens incluídas */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Ordens incluídas</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {preview.orders.map(o => (
                        <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F9FAFB] border border-[#0F1E3C]/6">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#0F1E3C]">{o.number}</span>
                            <span className="text-xs text-[#0F1E3C]/50">{o.productName}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[#0F1E3C]/40">{fmtDate(o.concludedAt)}</span>
                            <span className="text-xs font-bold text-[#0F1E3C]">{o.totalPieces} pç</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Custos operacionais considerados */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">
                      Custos operacionais ({preview.periodDays} dias)
                    </p>
                    <div className="space-y-1.5">
                      {preview.operationalCosts.map(c => (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F9FAFB] border border-[#0F1E3C]/6">
                          <span className="text-xs text-[#0F1E3C]">{c.name}</span>
                          <div className="text-right">
                            <span className="text-xs font-bold text-[#0F1E3C]">{fmtR(c.periodValue)}</span>
                            <span className="text-[10px] text-[#0F1E3C]/35 ml-1">(mensal: {fmtR(c.monthlyValue)})</span>
                          </div>
                        </div>
                      ))}
                      {preview.operationalCosts.length === 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                          <AlertCircle size={13}/> Nenhum custo operacional cadastrado — o fechamento vai atribuir R$0,00.
                        </div>
                      )}
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                      <AlertCircle size={14}/> {error}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Aplicando ── */}
          {step === "confirmando" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 size={32} className="text-[#4361EE] animate-spin"/>
              <p className="text-sm font-semibold text-[#0F1E3C]">Aplicando fechamento...</p>
              <p className="text-xs text-[#0F1E3C]/40">Atualizando custos por SKU</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0">
          {step === "periodo" && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
                Cancelar
              </button>
              <button onClick={handlePreview} disabled={loading || !start || !end}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold disabled:opacity-40 hover:bg-[#3451d1] transition-colors">
                {loading ? <Loader2 size={14} className="animate-spin"/> : <ChevronRight size={14}/>}
                Ver Prévia
              </button>
            </>
          )}
          {step === "preview" && (
            <>
              <button onClick={() => { setStep("periodo"); setError(null) }}
                className="px-4 py-2 text-sm text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
                ← Voltar
              </button>
              {preview?.orderCount ? (
                <button onClick={handleConfirm}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors">
                  <Check size={14}/> Confirmar Fechamento
                </button>
              ) : (
                <button onClick={onClose}
                  className="px-5 py-2.5 rounded-xl bg-[#0F1E3C]/8 text-[#0F1E3C]/50 text-sm font-bold">
                  Fechar
                </button>
              )}
            </>
          )}
          {step === "confirmando" && (
            <div className="w-full text-center text-xs text-[#0F1E3C]/30">Aguarde...</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function FechamentoPage() {
  const [closures, setClosures] = useState<Closure[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showModal, setShowModal] = useState(false)

  const loadClosures = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/cost-closures")
      if (res.ok) setClosures(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadClosures() }, [loadClosures])

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Fechamento de Período
          </h1>
          <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
            Distribui custos operacionais (salários, aluguel, etc.) entre as ordens do período
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451d1] transition-colors shadow-sm">
          <Calculator size={15}/> Novo Fechamento
        </button>
      </div>

      {/* Como funciona */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            step: "1",
            title: "Custo de Insumo",
            desc: "Calculado automaticamente ao concluir cada ordem — proporcional ao peso do tecido por tamanho.",
            color: "bg-blue-50 border-blue-200 text-blue-700",
          },
          {
            step: "2",
            title: "Custo Operacional",
            desc: "Salários, aluguel, energia — distribuídos via Fechamento de Período, proporcional às peças produzidas.",
            color: "bg-violet-50 border-violet-200 text-violet-700",
          },
          {
            step: "3",
            title: "Custo Total/SKU",
            desc: "Insumo + Operacional = custo real por peça, atualizado automaticamente no estoque e custo de produção.",
            color: "bg-emerald-50 border-emerald-200 text-emerald-700",
          },
        ].map(({ step, title, desc, color }) => (
          <div key={step} className={`px-4 py-4 rounded-xl border ${color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-current opacity-20 flex items-center justify-center text-[10px] font-black text-current"
                style={{ color: "inherit", opacity: 1, background: "currentColor" }}>
              </span>
              <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-[10px] font-black">{step}</span>
              <p className="text-xs font-bold">{title}</p>
            </div>
            <p className="text-xs opacity-70 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Histórico */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="text-sm font-bold text-[#0F1E3C]">Histórico de Fechamentos</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-[#4361EE] animate-spin"/>
          </div>
        ) : closures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#0F1E3C]/25">
            <Calendar size={36} className="mb-3"/>
            <p className="text-sm font-semibold">Nenhum fechamento realizado</p>
            <p className="text-xs mt-1">Clique em "Novo Fechamento" para começar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#0F1E3C]/8 bg-[#F9FAFB]">
                  {["Período","Dias","Ordens","Peças","Custo Op.","Custo/kg·peso","Data"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closures.map((c, i) => (
                  <tr key={c.id} className={`border-b border-[#0F1E3C]/4 last:border-0 ${i % 2 === 1 ? "bg-[#F9FAFB]/50" : ""}`}>
                    <td className="px-5 py-3.5 font-semibold text-[#0F1E3C]">
                      {fmtDate(c.periodStart)} — {fmtDate(c.periodEnd)}
                    </td>
                    <td className="px-5 py-3.5 text-[#0F1E3C]/60">{c.periodDays}d</td>
                    <td className="px-5 py-3.5 text-[#0F1E3C]">{c.orderCount}</td>
                    <td className="px-5 py-3.5 text-[#0F1E3C]">{c.totalPieces}</td>
                    <td className="px-5 py-3.5 font-bold text-[#4361EE]">
                      {fmtR(Number(c.totalOperational))}
                    </td>
                    <td className="px-5 py-3.5 text-[#0F1E3C]/60">
                      {fmtR(Number(c.costPerWeightUnit))}<span className="text-[10px]">/kg</span>
                    </td>
                    <td className="px-5 py-3.5 text-[#0F1E3C]/40 text-xs">
                      {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <NovoFechamentoModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); loadClosures() }}
        />
      )}
    </div>
  )
}
