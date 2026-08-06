"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  RefreshCw, Plus, X, Loader2, ChevronLeft, ChevronRight,
  AlertCircle, Clock, CheckCircle, DollarSign, Trash2,
} from "lucide-react"
import { todayBR, fmtDateOnlyBR } from "@/lib/tz"

type Payable = {
  id: number
  description: string
  category: string | null
  amount: number
  dueDate: string
  paidAt: string | null
  paidAmount: number | null
  notes: string | null
  createdBy: string
  createdAt: string
}

const CATEGORIES = ["Fornecedor", "Aluguel", "Imposto", "Salário", "Serviço", "Outros"]
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

function fmtCurrency(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

function pad(n: number) { return String(n).padStart(2, "0") }

function isoDate(y: number, m: number, d: number) {
  const dt = new Date(y, m, d)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function buildGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const cells: { date: string; inMonth: boolean }[] = []
  for (let i = firstWeekday; i > 0; i--) cells.push({ date: isoDate(year, month, 1 - i), inMonth: false })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: isoDate(year, month, d), inMonth: true })
  let trailing = 1
  while (cells.length % 7 !== 0) {
    cells.push({ date: isoDate(year, month + 1, trailing), inMonth: false })
    trailing++
  }
  return cells
}

export default function ContasAPagarPage() {
  const [payables, setPayables] = useState<Payable[]>([])
  const [loading,  setLoading]  = useState(true)
  const [cursor,   setCursor]   = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [viewDay, setViewDay] = useState<string | null>(null)
  const [showNew, setShowNew] = useState<string | null>(null) // holds default date, or null when closed

  const today = todayBR()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/payables")
      setPayables(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const byDate = useMemo(() => {
    const map = new Map<string, Payable[]>()
    for (const p of payables) {
      if (!map.has(p.dueDate)) map.set(p.dueDate, [])
      map.get(p.dueDate)!.push(p)
    }
    return map
  }, [payables])

  const grid = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const monthKey     = `${cursor.year}-${pad(cursor.month + 1)}`
  const monthTotal   = payables.filter(p => p.dueDate.startsWith(monthKey)).reduce((s, p) => s + p.amount, 0)
  const overdue      = payables.filter(p => !p.paidAt && p.dueDate < today)
  const overdueTotal = overdue.reduce((s, p) => s + p.amount, 0)
  const todayList    = payables.filter(p => p.dueDate === today && !p.paidAt)
  const todayTotal   = todayList.reduce((s, p) => s + p.amount, 0)
  const pending      = payables.filter(p => !p.paidAt)
  const pendingTotal = pending.reduce((s, p) => s + p.amount, 0)

  async function handlePay(id: number) {
    await fetch(`/api/payables/${id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    await load()
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir esse lançamento?")) return
    await fetch(`/api/payables/${id}`, { method: "DELETE" })
    await load()
  }

  function prevMonth() { setCursor(c => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } }) }
  function nextMonth() { setCursor(c => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } }) }
  function goToday()   { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }) }

  const viewDayPayables = viewDay ? (byDate.get(viewDay) ?? []) : []

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Contas a Pagar
          </h1>
          <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Calendário de pagamentos a fazer</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors border border-[#0F1E3C]/8">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setShowNew(today)}
            className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            <Plus size={14} /> Nova Conta
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-[#4361EE]/10 flex items-center justify-center">
              <DollarSign size={14} className="text-[#4361EE]" />
            </div>
            <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Total do Mês</span>
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(monthTotal)}</p>
        </div>

        <div className={`bg-white rounded-2xl border shadow-sm p-5 ${overdue.length > 0 ? "border-red-200 bg-red-50/30" : "border-[#0F1E3C]/8"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-red-100 flex items-center justify-center">
              <AlertCircle size={14} className="text-red-500" />
            </div>
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wider">Vencidas</span>
          </div>
          <p className="text-2xl font-black text-red-600">{fmtCurrency(overdueTotal)}</p>
          <p className="text-xs text-red-400 mt-1">{overdue.length} conta{overdue.length !== 1 ? "s" : ""}</p>
        </div>

        <div className={`bg-white rounded-2xl border shadow-sm p-5 ${todayList.length > 0 ? "border-amber-200 bg-amber-50/30" : "border-[#0F1E3C]/8"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center">
              <Clock size={14} className="text-amber-500" />
            </div>
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Vence Hoje</span>
          </div>
          <p className="text-2xl font-black text-amber-600">{fmtCurrency(todayTotal)}</p>
          <p className="text-xs text-amber-500 mt-1">{todayList.length} conta{todayList.length !== 1 ? "s" : ""}</p>
        </div>

        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-blue-100 flex items-center justify-center">
              <CheckCircle size={14} className="text-blue-500" />
            </div>
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Pendente (total)</span>
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(pendingTotal)}</p>
          <p className="text-xs text-[#0F1E3C]/30 mt-1">{pending.length} conta{pending.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm px-4 py-3">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/50 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          <p className="text-sm font-bold text-[#0F1E3C]">{MONTH_NAMES[cursor.month]} {cursor.year}</p>
          <button onClick={goToday} className="text-[10px] font-bold text-[#4361EE] hover:underline">hoje</button>
        </div>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/50 transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-[#0F1E3C]/30">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4">
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {WEEKDAYS.map(w => (
              <p key={w} className="text-center text-[9px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider pb-1">{w}</p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {grid.map(cell => {
              const dayPayables = byDate.get(cell.date) ?? []
              const dayNum      = Number(cell.date.slice(8, 10))
              const hasUnpaid   = dayPayables.some(p => !p.paidAt)
              const isPast      = cell.date < today
              const isToday     = cell.date === today
              const dayTotal    = dayPayables.reduce((s, p) => s + p.amount, 0)

              let cellCls = "bg-white border-[#0F1E3C]/6 hover:border-[#4361EE]/30"
              if (!cell.inMonth) cellCls = "bg-[#F9FAFB] border-transparent opacity-40"
              else if (hasUnpaid && isPast) cellCls = "bg-red-50 border-red-200 hover:border-red-300"
              else if (hasUnpaid && isToday) cellCls = "bg-amber-50 border-amber-200 hover:border-amber-300"
              else if (dayPayables.length > 0) cellCls = "bg-blue-50/50 border-blue-100 hover:border-blue-200"

              return (
                <button
                  key={cell.date}
                  onClick={() => cell.inMonth && setViewDay(cell.date)}
                  disabled={!cell.inMonth}
                  className={`aspect-square rounded-xl border p-1.5 flex flex-col items-start text-left transition-colors ${cellCls}`}
                >
                  <span className={`text-xs font-bold ${
                    isToday ? "text-[#4361EE]" : cell.inMonth ? "text-[#0F1E3C]/70" : "text-[#0F1E3C]/25"
                  }`}>
                    {dayNum}
                  </span>
                  {dayPayables.length > 0 && (
                    <div className="mt-auto w-full">
                      <span className={`block text-[9px] font-bold truncate ${
                        hasUnpaid ? (isPast ? "text-red-600" : "text-amber-600") : "text-emerald-600"
                      }`}>
                        {fmtCurrency(dayTotal)}
                      </span>
                      <span className="text-[8px] text-[#0F1E3C]/30">
                        {dayPayables.length} conta{dayPayables.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Day modal */}
      {viewDay && (
        <DayModal
          date={viewDay}
          payables={viewDayPayables}
          onClose={() => setViewDay(null)}
          onPay={handlePay}
          onDelete={handleDelete}
          onAdd={() => { setShowNew(viewDay); setViewDay(null) }}
        />
      )}

      {/* New payable modal */}
      {showNew && (
        <NewPayableModal
          defaultDate={showNew}
          onClose={() => setShowNew(null)}
          onSuccess={async () => { setShowNew(null); await load() }}
        />
      )}
    </div>
  )
}

// ─── DayModal ───────────────────────────────────────────────────────────────

function DayModal({
  date, payables, onClose, onPay, onDelete, onAdd,
}: {
  date: string
  payables: Payable[]
  onClose: () => void
  onPay: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onAdd: () => void
}) {
  const total = payables.reduce((s, p) => s + p.amount, 0)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <div>
              <h2 className="text-sm font-bold text-[#0F1E3C]">{fmtDateOnlyBR(date)}</h2>
              {payables.length > 0 && (
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                  {payables.length} conta{payables.length !== 1 ? "s" : ""} · {fmtCurrency(total)}
                </p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {payables.length === 0 ? (
              <p className="text-sm text-[#0F1E3C]/30 text-center py-8">Nenhuma conta nesse dia.</p>
            ) : (
              payables.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[#F4F6FB]">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F1E3C] truncate">{p.description}</p>
                    <p className="text-[10px] text-[#0F1E3C]/40">
                      {p.category ?? "Sem categoria"} · {fmtCurrency(p.amount)}
                      {p.paidAt && <span className="text-emerald-600 font-semibold"> · Pago</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!p.paidAt && (
                      <button onClick={() => onPay(p.id)} title="Dar baixa"
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors">
                        <CheckCircle size={14} />
                      </button>
                    )}
                    <button onClick={() => onDelete(p.id)} title="Excluir"
                      className="p-1.5 rounded-lg text-[#0F1E3C]/25 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-5 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0">
            <button onClick={onAdd}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-[#4361EE]/30 text-sm font-bold text-[#4361EE] hover:bg-[#4361EE]/5 transition-colors">
              <Plus size={14} /> Adicionar conta nesse dia
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── NewPayableModal ────────────────────────────────────────────────────────

function NewPayableModal({
  defaultDate, onClose, onSuccess,
}: {
  defaultDate: string
  onClose: () => void
  onSuccess: () => Promise<void>
}) {
  const [description, setDescription] = useState("")
  const [category,    setCategory]    = useState("")
  const [amount,      setAmount]      = useState("")
  const [dueDate,     setDueDate]     = useState(defaultDate)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState("")

  const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25"

  async function handleSubmit() {
    setError("")
    const numVal = Number(amount.replace(",", "."))
    if (!description.trim()) return setError("Informe a descrição.")
    if (!numVal || numVal <= 0) return setError("Informe um valor válido.")
    if (!dueDate) return setError("Informe o vencimento.")
    setSaving(true)
    try {
      const res = await fetch("/api/payables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), category: category || null, amount: numVal, dueDate }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Erro."); return }
      await onSuccess()
    } catch { setError("Erro de conexão.") }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Nova Conta a Pagar</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Lançamento manual de pagamento a fazer</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Descrição *</label>
              <input className={inputCls} placeholder="Ex: Aluguel julho, fornecedor tecidos..." value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Categoria</label>
              <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Sem categoria</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Valor *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#0F1E3C]/40 pointer-events-none">R$</span>
                  <input type="text" inputMode="decimal" className={inputCls + " pl-9"} placeholder="0,00"
                    value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d,.]/g, ""))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Vencimento *</label>
                <input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">Cancelar</button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Criar Conta
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
