"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { CheckCircle2, Clock, X, Check, AlertTriangle, Scissors, ChevronDown, ChevronUp } from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────
type RevisaoStatus = "aguardando" | "concluida"

type GradeItem = {
  color: string
  size: string
  qty: number
  aprovadas?: number
  avarias?: number
}

type OrdemRevisao = {
  id:            number
  number:        string
  productName:   string
  status:        RevisaoStatus
  grade:         GradeItem[]
  concludedAt:   string
  revisadoAt?:   string
  totalPecas:    number
  totalAprovadas?: number
  totalAvarias?:   number
}

// Mock removed — data comes from /api/prod-orders

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s: string) {
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

// ─── RevisaoModal ──────────────────────────────────────────────────────────────
function RevisaoModal({
  ordem,
  onClose,
  onConcluir,
}: {
  ordem:      OrdemRevisao
  onClose:    () => void
  onConcluir: (id: number, grade: GradeItem[]) => void
}) {
  // avarias[i] = qty avaria para o item grade[i]
  const [avarias, setAvarias] = useState<Record<number, string>>(
    Object.fromEntries(ordem.grade.map((_, i) => [i, "0"]))
  )

  const rows = ordem.grade.map((g, i) => {
    const av = Math.min(Math.max(Number(avarias[i]) || 0, 0), g.qty)
    return { ...g, avaria: av, aprovada: g.qty - av }
  })

  const totalAprovadas = rows.reduce((s, r) => s + r.aprovada, 0)
  const totalAvarias   = rows.reduce((s, r) => s + r.avaria,  0)
  const totalDistrib   = totalAprovadas + totalAvarias
  const valid          = rows.every(r => r.avaria >= 0 && r.avaria <= r.qty) && totalDistrib === ordem.totalPecas

  const colorGroups = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!map.has(r.color)) map.set(r.color, [])
      map.get(r.color)!.push(r)
    }
    return [...map.entries()]
  }, [rows])

  function handleConcluir() {
    const finalGrade: GradeItem[] = rows.map(r => ({
      color: r.color, size: r.size, qty: r.qty,
      aprovadas: r.aprovada, avarias: r.avaria,
    }))
    onConcluir(ordem.id, finalGrade)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
              Revisão — {ordem.number}
            </h3>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {ordem.productName} · {ordem.totalPecas} pç produzidas
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center">
            <X size={15}/>
          </button>
        </div>

        {/* Grade */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Column header */}
          <div className="grid grid-cols-[1fr_56px_80px_80px] gap-2 pb-2 border-b border-[#0F1E3C]/6">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">SKU</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 text-center">Total</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 text-center">Aprovadas</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 text-center">Avarias</span>
          </div>

          {colorGroups.map(([color, colorRows]) => (
            <div key={color}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">{color}</p>
              <div className="space-y-2">
                {colorRows.map((r, ci) => {
                  const globalIdx = ordem.grade.findIndex(g => g.color === r.color && g.size === r.size)
                  return (
                    <div key={ci}
                      className="grid grid-cols-[1fr_56px_80px_80px] gap-2 items-center px-3 py-2.5 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6">
                      <span className="text-sm font-semibold text-[#0F1E3C]">{r.size}</span>
                      <span className="text-sm font-bold text-[#0F1E3C] text-center">{r.qty}</span>
                      <span className="text-sm font-bold text-emerald-600 text-center">{r.aprovada}</span>
                      <input
                        type="number" min="0" max={r.qty}
                        value={avarias[globalIdx]}
                        onChange={e => setAvarias(prev => ({ ...prev, [globalIdx]: e.target.value }))}
                        className="w-full text-center text-sm font-bold text-amber-700 border border-amber-200 rounded-lg px-2 py-1.5 bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Totals row */}
          <div className="grid grid-cols-[1fr_56px_80px_80px] gap-2 items-center pt-3 border-t-2 border-[#0F1E3C]/8">
            <span className="text-xs font-bold text-[#0F1E3C]">Total</span>
            <span className="text-sm font-black text-[#0F1E3C] text-center">{ordem.totalPecas}</span>
            <span className="text-sm font-black text-emerald-600 text-center">{totalAprovadas}</span>
            <span className="text-sm font-black text-amber-600 text-center">{totalAvarias}</span>
          </div>

          {/* Validation: total must match */}
          {totalDistrib !== ordem.totalPecas && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
              <p className="text-xs text-red-700 font-semibold">
                {totalDistrib < ordem.totalPecas
                  ? `Faltam ${ordem.totalPecas - totalDistrib} pç — distribua entre aprovadas e avarias`
                  : `Excesso de ${totalDistrib - ordem.totalPecas} pç — revise as quantidades`}
              </p>
            </div>
          )}

          {/* Destination preview */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="text-xs font-semibold text-emerald-700">→ Estoque principal</span>
              <span className="text-base font-black text-emerald-700">{totalAprovadas} pç</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
              <span className="text-xs font-semibold text-amber-700">→ Estoque avarias</span>
              <span className="text-base font-black text-amber-700">{totalAvarias} pç</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#0F1E3C]/6 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={handleConcluir}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold
              disabled:opacity-40 hover:bg-[#3451d1] transition-colors">
            <Check size={15}/>
            Concluir Revisão
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── OrderCard ─────────────────────────────────────────────────────────────────
function OrderCard({
  ordem,
  onRevisar,
}: {
  ordem:     OrdemRevisao
  onRevisar: (o: OrdemRevisao) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const concluida = ordem.status === "concluida"

  const colorGroups = useMemo(() => {
    const map = new Map<string, GradeItem[]>()
    for (const g of ordem.grade) {
      if (!map.has(g.color)) map.set(g.color, [])
      map.get(g.color)!.push(g)
    }
    return [...map.entries()]
  }, [ordem.grade])

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${
      concluida ? "border-[#0F1E3C]/6" : "border-[#4361EE]/20"
    }`}>

      {/* Summary row */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          concluida ? "bg-emerald-500" : "bg-amber-400"
        }`}/>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[#0F1E3C] text-sm">{ordem.number}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#4361EE]/8 text-[#4361EE]">
              {ordem.productName}
            </span>
            {!concluida && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide">
                Aguardando revisão
              </span>
            )}
          </div>
          <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
            {ordem.totalPecas} pç produzidas · conc. produção {fmtDate(ordem.concludedAt)}
            {concluida && ordem.revisadoAt && ` · revisado ${fmtDate(ordem.revisadoAt)}`}
          </p>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {concluida ? (
            <div className="text-right">
              <p className="text-xs font-bold text-emerald-600">{ordem.totalAprovadas} aprovadas</p>
              {(ordem.totalAvarias ?? 0) > 0 && (
                <p className="text-xs font-bold text-amber-600">{ordem.totalAvarias} avarias</p>
              )}
            </div>
          ) : (
            <button
              onClick={() => onRevisar(ordem)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#4361EE] text-white text-xs font-bold hover:bg-[#3451d1] transition-colors">
              <Scissors size={12}/>
              Revisar
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/30 flex items-center justify-center">
            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#0F1E3C]/5 px-5 py-4 bg-[#F9FAFB]">
          <div className="space-y-3">
            {colorGroups.map(([color, rows]) => (
              <div key={color}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">{color}</p>
                <div className="grid grid-cols-[1fr_64px_80px_80px] gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30">Tam.</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30 text-center">Total</span>
                  {concluida && <>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 text-center">Aprov.</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 text-center">Avar.</span>
                  </>}
                </div>
                {rows.map(r => (
                  <div key={r.size}
                    className="grid grid-cols-[1fr_64px_80px_80px] gap-2 items-center py-1.5 border-b border-[#0F1E3C]/4 last:border-0">
                    <span className="text-sm font-bold text-[#0F1E3C]">{r.size}</span>
                    <span className="text-sm text-[#0F1E3C]/60 text-center">{r.qty}</span>
                    {concluida && <>
                      <span className="text-sm font-semibold text-emerald-600 text-center">{r.aprovadas ?? "—"}</span>
                      <span className="text-sm font-semibold text-amber-600 text-center">{r.avarias ?? "—"}</span>
                    </>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
// Maps a prod_order (from API) to OrdemRevisao shape
function mapOrder(o: {
  id: number; number: string; productName: string; status: string
  grade: { color:string; size:string; qtyProduced?:number }[]
  concludedAt?: string
  totalAprovadas?: number
  totalAvarias?:   number
}): OrdemRevisao {
  const grade: GradeItem[] = (o.grade ?? [])
    .filter(g => (g.qtyProduced ?? 0) > 0)
    .map(g => ({ color: g.color, size: g.size, qty: g.qtyProduced! }))
  const totalPecas = grade.reduce((s, g) => s + g.qty, 0)
  const apiStatus: RevisaoStatus = o.status === "encerrada" ? "concluida" : "aguardando"
  return {
    id: o.id, number: o.number, productName: o.productName,
    status: apiStatus, grade, totalPecas,
    concludedAt:   o.concludedAt ?? "",
    totalAprovadas: o.totalAprovadas ?? 0,
    totalAvarias:   o.totalAvarias   ?? 0,
  }
}

export default function CosturaRevisaoPage() {
  const [ordens, setOrdens] = useState<OrdemRevisao[]>([])
  const [loading, setLoading] = useState(true)
  const [revisando, setRevisando] = useState<OrdemRevisao | null>(null)

  const loadOrdens = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/prod-orders?status=concluida,encerrada")
      if (res.ok) {
        const data = await res.json()
        setOrdens(data.map(mapOrder))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadOrdens() }, [loadOrdens])

  const pendentes  = ordens.filter(o => o.status === "aguardando")
  const concluidas = ordens.filter(o => o.status === "concluida")

  const totalRevisadas  = concluidas.reduce((s, o) => s + o.totalPecas, 0)
  const totalAvarias    = concluidas.reduce((s, o) => s + (o.totalAvarias ?? 0), 0)
  const pctAvaria       = totalRevisadas > 0 ? (totalAvarias / totalRevisadas) * 100 : 0

  async function handleConcluir(id: number, finalGrade: GradeItem[]) {
    await fetch(`/api/prod-orders/${id}/revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: finalGrade }),
    })
    setRevisando(null)
    loadOrdens()
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
          Costura e Revisão
        </h1>
        <p className="text-xs text-[#0F1E3C]/45 mt-1">
          Revisão de qualidade · aprovadas → estoque · avarias → estoque de avarias
        </p>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-[#0F1E3C]/6">
          {[
            { label:"Aguardando revisão", display: String(pendentes.length),           color:"text-amber-500"   },
            { label:"Revisões concluídas",display: String(concluidas.length),          color:"text-emerald-600" },
            { label:"Peças revisadas",    display: `${totalRevisadas} pç`,             color:"text-[#0F1E3C]"   },
            { label:"Taxa de avaria",     display: `${pctAvaria.toFixed(1)}%`,         color: pctAvaria > 3 ? "text-amber-500" : "text-[#0F1E3C]" },
          ].map(s => (
            <div key={s.label} className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.display}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pendentes */}
      {pendentes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={13} className="text-amber-500"/>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">
              Aguardando Revisão ({pendentes.length})
            </p>
          </div>
          <div className="space-y-3">
            {pendentes.map(o => (
              <OrderCard key={o.id} ordem={o} onRevisar={setRevisando}/>
            ))}
          </div>
        </div>
      )}

      {pendentes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-[#0F1E3C]/25">
          <CheckCircle2 size={28} className="mb-2 text-emerald-400"/>
          <p className="text-sm font-semibold">Nenhuma ordem aguardando revisão</p>
        </div>
      )}

      {/* Histórico */}
      {concluidas.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={13} className="text-emerald-500"/>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">
              Histórico de Revisões ({concluidas.length})
            </p>
          </div>
          <div className="space-y-3">
            {concluidas.map(o => (
              <OrderCard key={o.id} ordem={o} onRevisar={setRevisando}/>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {revisando && (
        <RevisaoModal
          ordem={revisando}
          onClose={() => setRevisando(null)}
          onConcluir={handleConcluir}
        />
      )}
    </div>
  )
}
