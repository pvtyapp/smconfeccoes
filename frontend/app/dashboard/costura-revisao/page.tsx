"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { CheckCircle2, Clock, X, Check, AlertTriangle, ChevronDown, ChevronUp, Printer, PlayCircle } from "lucide-react"
import { todayBR, subDaysBR, dateBR } from "@/lib/tz"
import { printWhenReady } from "@/components/print/print-utils"
import RevisaoPrintSheet, { type RevisaoFichaData } from "./RevisaoPrintSheet"

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
  revisedAt?:    string | null
  totalPecas:    number
  totalAprovadas?: number
  totalAvarias?:   number
  fichaImpressaAt?: string | null
}

// ─── Período ────────────────────────────────────────────────────────────────────
type PeriodKey = "hoje" | "ontem" | "7d" | "30d"

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "hoje",  label: "Hoje"    },
  { key: "ontem", label: "Ontem"   },
  { key: "7d",    label: "7 dias"  },
  { key: "30d",   label: "30 dias" },
]

function getPeriodRange(key: PeriodKey): [string, string] {
  switch (key) {
    case "hoje":  return [todayBR(), todayBR()]
    case "ontem": return [subDaysBR(1), subDaysBR(1)]
    case "7d":    return [subDaysBR(6), todayBR()]
    case "30d":   return [subDaysBR(29), todayBR()]
  }
}

// Mock removed — data comes from /api/prod-orders

// ─── RevisaoModal ──────────────────────────────────────────────────────────────
function RevisaoModal({
  ordem,
  onClose,
  onConcluir,
}: {
  ordem:      OrdemRevisao
  onClose:    () => void
  onConcluir: (id: number, grade: GradeItem[]) => Promise<void>
}) {
  // avarias[i] = qty avaria para o item grade[i]
  const [avarias, setAvarias] = useState<Record<number, string>>(
    Object.fromEntries(ordem.grade.map((_, i) => [i, "0"]))
  )
  const [submitting, setSubmitting] = useState(false)

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

  async function handleConcluir() {
    const finalGrade: GradeItem[] = rows.map(r => ({
      color: r.color, size: r.size, qty: r.qty,
      aprovadas: r.aprovada, avarias: r.avaria,
    }))
    setSubmitting(true)
    try {
      await onConcluir(ordem.id, finalGrade)
    } catch {
      alert("Falha ao concluir revisão — confere a conexão e tenta de novo")
      setSubmitting(false)
    }
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
          <button onClick={onClose} disabled={submitting}
            className="px-4 py-2 text-sm text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors disabled:opacity-40">
            Cancelar
          </button>
          <button
            disabled={!valid || submitting}
            onClick={handleConcluir}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold
              disabled:opacity-40 hover:bg-[#3451d1] transition-colors">
            <Check size={15}/>
            {submitting ? "Concluindo..." : "Concluir Revisão"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PendingCard ───────────────────────────────────────────────────────────────
// Bloco 1:1 com LED azul girando ao redor — sinaliza "precisa de ação".
// Clique abre o RevisaoModal (grade completa por cor/tamanho).
function colorChips(grade: GradeItem[]): { shown: string[]; extra: number } {
  const colors: string[] = []
  for (const g of grade) if (!colors.includes(g.color)) colors.push(g.color)
  return { shown: colors.slice(0, 2), extra: Math.max(0, colors.length - 2) }
}

// stage="entraram": ninguém tocou ainda — LED liga, só dá pra imprimir e
// iniciar (não abre revisão, papel ainda nem existe no chão de fábrica).
// stage="andamento": ficha já impressa, operador cortando/revisando no papel
// — LED desliga (deixou de ser urgente), card abre a revisão de verdade.
function PendingCard({ ordem, stage, onClick, onPrint }: {
  ordem: OrdemRevisao; stage: "entraram" | "andamento"; onClick: () => void; onPrint: () => void
}) {
  const { shown, extra } = useMemo(() => colorChips(ordem.grade), [ordem.grade])

  const card = (
    <div className="h-full w-full rounded-[18px] bg-white flex flex-col items-center justify-center text-center gap-1.5 p-4 relative">
      <p className="text-sm font-black text-[#0F1E3C] leading-tight">{ordem.productName}</p>
      <div className="flex gap-1 flex-wrap justify-center">
        {shown.map(c => (
          <span key={c} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#4361EE]/10 text-[#4361EE]">{c}</span>
        ))}
        {extra > 0 && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/8 text-[#0F1E3C]/50">+{extra}</span>
        )}
      </div>
      <span className="text-[10px] font-bold text-[#0F1E3C]/40 bg-[#F9FAFB] border border-[#0F1E3C]/8 px-2.5 py-0.5 rounded-full mt-1">
        {ordem.totalPecas} pç
      </span>
      {stage === "entraram" ? (
        <button onClick={e => { e.stopPropagation(); onPrint() }}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#4361EE] text-white text-[11px] font-bold hover:bg-[#3451D1] transition-colors">
          <Printer size={12}/> Imprimir e Iniciar
        </button>
      ) : (
        <button onClick={onClick}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500 text-white text-[11px] font-bold hover:bg-emerald-600 transition-colors">
          <CheckCircle2 size={12}/> Concluir
        </button>
      )}
    </div>
  )

  if (stage === "entraram") {
    return (
      <div className="led-wrap relative aspect-square">
        <div className="led-glow"/>
        <div className="led-ring h-full w-full">{card}</div>
      </div>
    )
  }
  return (
    <div className="relative aspect-square border border-[#0F1E3C]/8 rounded-[18px] hover:border-[#4361EE]/25 transition-colors">
      {card}
    </div>
  )
}

// ─── ConcludedCard ─────────────────────────────────────────────────────────────
// Versão compacta, sem LED — usada só dentro do histórico minimizado.
function ConcludedCard({ ordem }: { ordem: OrdemRevisao }) {
  return (
    <div className="aspect-square rounded-2xl bg-white border border-[#0F1E3C]/6 flex flex-col
      items-center justify-center text-center gap-1 p-3">
      <CheckCircle2 size={16} className="text-emerald-500"/>
      <p className="text-xs font-bold text-[#0F1E3C] leading-tight">{ordem.productName}</p>
      <p className="text-[10px] font-semibold text-emerald-600">{ordem.totalAprovadas} aprov.</p>
      {(ordem.totalAvarias ?? 0) > 0 && (
        <p className="text-[10px] font-semibold text-amber-600">{ordem.totalAvarias} avaria{ordem.totalAvarias! > 1 ? "s" : ""}</p>
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
  revisedAt?: string | null
  totalAprovadas?: number
  totalAvarias?:   number
  fichaImpressaAt?: string | null
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
    revisedAt:     o.revisedAt   ?? null,
    totalAprovadas: o.totalAprovadas ?? 0,
    totalAvarias:   o.totalAvarias   ?? 0,
    fichaImpressaAt: o.fichaImpressaAt ?? null,
  }
}

export default function CosturaRevisaoPage() {
  const [ordens, setOrdens] = useState<OrdemRevisao[]>([])
  const [loading, setLoading] = useState(true)
  const [revisando, setRevisando] = useState<OrdemRevisao | null>(null)
  const [printando, setPrintando] = useState<RevisaoFichaData | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [period, setPeriod] = useState<PeriodKey>("hoje")

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

  // "Em andamento" nasce sozinho quando a ficha é impressa — sem status
  // manual novo pra alguém lembrar de trocar.
  const entraram    = pendentes.filter(o => !o.fichaImpressaAt)
  const emAndamento = pendentes.filter(o => !!o.fichaImpressaAt)

  async function handlePrint(ordem: OrdemRevisao) {
    await fetch(`/api/prod-orders/${ordem.id}/print-ficha`, { method: "POST" }).catch(() => {})
    setPrintando({ number: ordem.number, productName: ordem.productName, totalPecas: ordem.totalPecas, grade: ordem.grade })
    printWhenReady()
    loadOrdens()
  }

  // Dashboard e histórico respeitam o período — pendentes fica sempre com a fila toda
  const [periodFrom, periodTo] = getPeriodRange(period)
  const concluidasPeriodo = useMemo(() => concluidas.filter(o => {
    const ref = o.revisedAt ?? o.concludedAt
    if (!ref) return false
    const key = dateBR(new Date(ref))
    return key >= periodFrom && key <= periodTo
  }), [concluidas, periodFrom, periodTo])

  const totalRevisadas  = concluidasPeriodo.reduce((s, o) => s + o.totalPecas, 0)
  const totalAvarias    = concluidasPeriodo.reduce((s, o) => s + (o.totalAvarias ?? 0), 0)
  const pctAvaria       = totalRevisadas > 0 ? (totalAvarias / totalRevisadas) * 100 : 0

  async function handleConcluir(id: number, finalGrade: GradeItem[]) {
    const res = await fetch(`/api/prod-orders/${id}/revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: finalGrade }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || "Falha ao concluir revisão")
    }
    setRevisando(null)
    loadOrdens()
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
            Costura e Revisão
          </h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-1">
            Revisão de qualidade · aprovadas → estoque · avarias → estoque de avarias
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#0F1E3C]/8 rounded-xl p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => setPeriod(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                period === opt.key
                  ? "bg-[#4361EE] text-white"
                  : "text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats — respeitam o período selecionado (exceto "Aguardando revisão", que é sempre a fila toda) */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-[#0F1E3C]/6">
          {[
            { label:"Aguardando revisão", display: String(pendentes.length),           color:"text-amber-500"   },
            { label:"Revisões concluídas",display: String(concluidasPeriodo.length),   color:"text-emerald-600" },
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

      {/* Em andamento — ficha já impressa, operador acompanhando no papel */}
      {emAndamento.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle size={13} className="text-[#4361EE]"/>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">
              Em Andamento ({emAndamento.length})
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {emAndamento.map(o => (
              <PendingCard key={o.id} ordem={o} stage="andamento" onClick={() => setRevisando(o)} onPrint={() => handlePrint(o)}/>
            ))}
          </div>
        </div>
      )}

      {/* Entraram — ninguém tocou ainda */}
      {entraram.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={13} className="text-amber-500"/>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">
              Entraram ({entraram.length})
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {entraram.map(o => (
              <PendingCard key={o.id} ordem={o} stage="entraram" onClick={() => setRevisando(o)} onPrint={() => handlePrint(o)}/>
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

      {/* Histórico — minimizado por padrão, respeita o período selecionado */}
      {concluidasPeriodo.length > 0 ? (
        <div>
          <button onClick={() => setHistOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-white border border-[#0F1E3C]/8 hover:border-[#4361EE]/25 transition-colors">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={14} className="text-emerald-500"/>
              <p className="text-sm font-bold text-[#0F1E3C]">{concluidasPeriodo.length} revisões concluídas</p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-[#4361EE]">
              ver histórico
              {histOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            </div>
          </button>
          {histOpen && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
              {concluidasPeriodo.map(o => (
                <ConcludedCard key={o.id} ordem={o}/>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#0F1E3C]/30 text-center py-4">Nenhuma revisão concluída nesse período</p>
      )}

      {/* Modal */}
      {revisando && (
        <RevisaoModal
          ordem={revisando}
          onClose={() => setRevisando(null)}
          onConcluir={handleConcluir}
        />
      )}

      {printando && (
        <RevisaoPrintSheet ordem={printando} onDone={() => setPrintando(null)}/>
      )}

      <style jsx global>{`
        @property --led-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes led-spin { to { --led-angle: 360deg; } }
        @keyframes led-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }

        .led-wrap { position: relative; }

        .led-glow {
          position: absolute; inset: -14px; border-radius: 26px;
          background: conic-gradient(from var(--led-angle),
            transparent 0deg, #22D3EE 45deg, #7C9BFF 100deg, #4361EE 150deg, transparent 200deg, transparent 360deg);
          filter: blur(18px);
          animation: led-spin 2.2s linear infinite, led-pulse 2.2s ease-in-out infinite;
        }

        .led-ring {
          position: relative;
          border-radius: 20px;
          padding: 2.5px;
          background: conic-gradient(from var(--led-angle),
            transparent 0deg, #22D3EE 45deg, #7C9BFF 100deg, #4361EE 150deg, transparent 200deg, transparent 360deg);
          animation: led-spin 2.2s linear infinite;
        }
      `}</style>
    </div>
  )
}
