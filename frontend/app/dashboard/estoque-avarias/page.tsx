"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import {
  ChevronDown, ChevronRight, RefreshCw, X, Loader2, AlertTriangle,
  PackageOpen, ClipboardList, Calendar, ArrowUpRight, RotateCcw, Tag, Trash2, Check,
} from "lucide-react"

type Disposition = "pendente" | "reaproveitado" | "vendido" | "descartado"

type AvariaItem = {
  id:          number
  variantId:   string | null
  productName: string
  color:       string
  size:        string
  qty:         number
  disposition: Disposition
  notes:       string | null
  orderNumber: string | null
  createdAt:   string
}

type AvariaGroup = {
  productName: string
  items:       AvariaItem[]
  totalQty:    number
  hasPendente: boolean
}

const DISP_BADGE: Record<Disposition, string> = {
  pendente:      "bg-amber-100 text-amber-700",
  reaproveitado: "bg-blue-100 text-blue-700",
  vendido:       "bg-emerald-100 text-emerald-700",
  descartado:    "bg-[#0F1E3C]/6 text-[#0F1E3C]/35",
}

const DISP_LABEL: Record<Disposition, string> = {
  pendente:      "PENDENTE",
  reaproveitado: "REAPROVEITADO",
  vendido:       "VENDIDO",
  descartado:    "DESCARTADO",
}

// ─── Timezone helpers (Brasília = UTC-3 fixo) ────────────────────────────────

const BRT_MS = 3 * 60 * 60 * 1000

function brasiliaStartOf(daysAgo: number): Date {
  const nowBRT   = new Date(Date.now() - BRT_MS)
  const midnight = new Date(Date.UTC(
    nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate() - daysAgo,
  ))
  return new Date(midnight.getTime() + BRT_MS)
}

type FilterMode =
  | { type: "hoje" }
  | { type: "days"; days: number }
  | { type: "range"; from: string; to: string }

function filterDates(f: FilterMode): { from: Date; to: Date } {
  const now = new Date()
  if (f.type === "hoje") return { from: brasiliaStartOf(0), to: now }
  if (f.type === "days") return { from: brasiliaStartOf(f.days), to: now }
  return {
    from: new Date(f.from + "T00:00:00-03:00"),
    to:   new Date(f.to   + "T23:59:59-03:00"),
  }
}

function filterLabel(f: FilterMode): string {
  if (f.type === "hoje") return "Hoje"
  if (f.type === "days") return `${f.days}d`
  const fmt = (s: string) => s.slice(8) + "/" + s.slice(5, 7)
  return `${fmt(f.from)} – ${fmt(f.to)}`
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function todayBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{label}</p>
      <p className={`text-2xl font-black mt-1 ${accent ?? "text-[#0F1E3C]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#0F1E3C]/35 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── AvariaColorBlock ─────────────────────────────────────────────────────────

function AvariaColorBlock({
  color, items, onEdit,
}: {
  color:  string
  items:  AvariaItem[]
  onEdit: (item: AvariaItem) => void
}) {
  const hasPendente = items.some(i => i.disposition === "pendente")
  const sizeMap = new Map<string, AvariaItem[]>()
  for (const item of items) {
    if (!sizeMap.has(item.size)) sizeMap.set(item.size, [])
    sizeMap.get(item.size)!.push(item)
  }
  const sizeGroups = [...sizeMap.entries()]

  return (
    <div className={`flex-shrink-0 border rounded-2xl overflow-hidden min-w-[180px] ${hasPendente ? "border-amber-200" : "border-[#0F1E3C]/8"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 ${hasPendente ? "bg-amber-50" : "bg-[#F4F6FB]"}`}>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasPendente ? "bg-amber-400" : "bg-blue-400"}`} />
        <span className="text-sm font-bold text-[#0F1E3C] truncate">{color || "Sem cor"}</span>
      </div>
      <div className="divide-y divide-[#0F1E3C]/6">
        {sizeGroups.map(([size, sizeItems]) => {
          const qty        = sizeItems.reduce((s, i) => s + i.qty, 0)
          const disp       = sizeItems[0]?.disposition ?? "pendente"
          const firstItem  = sizeItems[0]
          return (
            <button
              key={size}
              onClick={() => firstItem && onEdit(firstItem)}
              className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F9FAFB] transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F1E3C]">{size || "—"}</p>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${DISP_BADGE[disp]}`}>
                  {DISP_LABEL[disp]}
                </span>
              </div>
              <span className="text-lg font-black flex-shrink-0 text-amber-500">{qty}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const PRESETS: FilterMode[] = [
  { type: "hoje" },
  { type: "days", days: 7  },
  { type: "days", days: 15 },
  { type: "days", days: 30 },
  { type: "days", days: 60 },
]

function isActive(f: FilterMode, active: FilterMode) {
  if (f.type !== active.type) return false
  if (f.type === "days" && active.type === "days") return f.days === active.days
  return f.type === active.type
}

export default function EstoqueAvariasPage() {
  const [avarias, setAvarias]           = useState<AvariaItem[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set())
  const [showSaida, setShowSaida]       = useState(false)
  const [editing, setEditing]           = useState<AvariaItem | null>(null)
  const [filter, setFilter]             = useState<FilterMode>({ type: "days", days: 30 })
  const [showCal, setShowCal]           = useState(false)
  const [calFrom, setCalFrom]           = useState(todayBRT())
  const [calTo, setCalTo]               = useState(todayBRT())
  const calRef                          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setShowCal(false)
    }
    if (showCal) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showCal])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/defect-stock?disposition=all")
      if (res.ok) setAvarias(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const { from: fromDate, to: toDate } = useMemo(() => filterDates(filter), [filter])

  const avariasInPeriod = useMemo(
    () => avarias.filter(a => { const d = new Date(a.createdAt); return d >= fromDate && d <= toDate }),
    [avarias, fromDate, toDate]
  )

  const stats = useMemo(() => {
    const totalQty = avarias.reduce((s, a) => s + a.qty, 0)
    const pendente = avarias.filter(a => a.disposition === "pendente").reduce((s, a) => s + a.qty, 0)
    const products = new Set(avarias.map(a => a.productName)).size
    const saidas   = avariasInPeriod.filter(a => a.disposition !== "pendente").reduce((s, a) => s + a.qty, 0)
    return { totalQty, pendente, products, saidas }
  }, [avarias, avariasInPeriod])

  const periodTag = filterLabel(filter)

  const groups = useMemo<AvariaGroup[]>(() => {
    const map = new Map<string, AvariaItem[]>()
    for (const item of avarias) {
      if (!map.has(item.productName)) map.set(item.productName, [])
      map.get(item.productName)!.push(item)
    }
    return [...map.entries()].map(([productName, items]) => ({
      productName,
      items:       items.sort((a, b) => a.color.localeCompare(b.color)),
      totalQty:    items.reduce((s, i) => s + i.qty, 0),
      hasPendente: items.some(i => i.disposition === "pendente"),
    }))
  }, [avarias])

  const historyItems = useMemo(
    () => [...avariasInPeriod].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [avariasInPeriod]
  )

  function toggleExpand(productName: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(productName) ? next.delete(productName) : next.add(productName)
      return next
    })
  }

  function toggleHistory(id: number) {
    setExpandedHistory(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave(id: number, disposition: Disposition, notes: string) {
    await fetch(`/api/defect-stock/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition, notes }),
    })
    setEditing(null)
    setShowSaida(false)
    await load()
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Estoque de Avarias</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Peças reprovadas na revisão · reaproveitar, vender com desconto ou descartar</p>
        </div>
        <div className="flex items-center gap-2">

          {/* Period filter */}
          <div className="flex items-center gap-1 bg-[#F4F6FB] rounded-xl p-1 border border-[#0F1E3C]/6">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => { setFilter(p); setShowCal(false) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isActive(p, filter)
                    ? "bg-white text-[#0F1E3C] shadow-sm"
                    : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"
                }`}
              >
                {filterLabel(p)}
              </button>
            ))}
          </div>

          {/* Calendar range */}
          <div className="relative" ref={calRef}>
            <button
              onClick={() => setShowCal(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                filter.type === "range"
                  ? "bg-[#4361EE] text-white border-[#4361EE]"
                  : "bg-[#F4F6FB] border-[#0F1E3C]/6 text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
              }`}
            >
              <Calendar size={13} />
              {filter.type === "range" ? filterLabel(filter) : "Range"}
            </button>

            {showCal && (
              <div className="absolute right-0 top-full mt-2 z-30 bg-white border border-[#0F1E3C]/10 rounded-2xl shadow-xl p-4 w-64">
                <p className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-3">Intervalo personalizado</p>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#0F1E3C]/40 mb-1">De</label>
                    <input
                      type="date" value={calFrom} max={calTo}
                      onChange={e => setCalFrom(e.target.value)}
                      className="w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#0F1E3C]/40 mb-1">Até</label>
                    <input
                      type="date" value={calTo} min={calFrom} max={todayBRT()}
                      onChange={e => setCalTo(e.target.value)}
                      className="w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
                    />
                  </div>
                  <button
                    onClick={() => { setFilter({ type: "range", from: calFrom, to: calTo }); setShowCal(false) }}
                    disabled={!calFrom || !calTo}
                    className="w-full mt-1 py-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            )}
          </div>

          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowSaida(true)}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <ArrowUpRight size={15} /> Saída
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total avariado"     value={`${stats.totalQty} pç`}  sub="todo o histórico"  accent="text-amber-500" />
        <StatCard label="Aguardando destino" value={`${stats.pendente} pç`}  sub="pendentes"         accent={stats.pendente > 0 ? "text-amber-500" : "text-[#0F1E3C]"} />
        <StatCard label="Produtos afetados"  value={String(stats.products)}  sub="total geral" />
        <StatCard label="Saídas período"     value={`${stats.saidas} pç`}    sub={periodTag}         accent="text-blue-500" />
      </div>

      {/* Product list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <PackageOpen size={40} strokeWidth={1.2} />
          <p className="text-sm">Nenhuma avaria registrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(group => {
            const isOpen = expanded.has(group.productName)

            const colorMap = new Map<string, AvariaItem[]>()
            for (const item of group.items) {
              if (!colorMap.has(item.color)) colorMap.set(item.color, [])
              colorMap.get(item.color)!.push(item)
            }
            const colorGroups = [...colorMap.entries()].sort(([a], [b]) => a.localeCompare(b))

            return (
              <div key={group.productName} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4">
                  <button
                    onClick={() => toggleExpand(group.productName)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className={`w-1.5 h-7 rounded-full flex-shrink-0 ${group.hasPendente ? "bg-amber-400" : "bg-blue-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#0F1E3C]">{group.productName}</p>
                      <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                        {colorGroups.length} {colorGroups.length === 1 ? "cor" : "cores"} · {group.totalQty} pç avariadas
                      </p>
                    </div>
                    {group.hasPendente && <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />}
                  </button>
                  <button onClick={() => toggleExpand(group.productName)} className="text-[#0F1E3C]/30 flex-shrink-0">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-[#0F1E3C]/6 p-4">
                    <div className="flex gap-3 flex-wrap">
                      {colorGroups.map(([color, items]) => (
                        <AvariaColorBlock key={color} color={color} items={items} onEdit={setEditing} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      {historyItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-[#0F1E3C]/30" />
              <h2 className="text-sm font-bold text-[#0F1E3C]">Histórico de registros</h2>
              <span className="text-xs text-[#0F1E3C]/35 bg-[#F4F6FB] px-2 py-0.5 rounded-full">{periodTag}</span>
            </div>
            <span className="text-xs text-[#0F1E3C]/30">{historyItems.length} registro(s)</span>
          </div>
          <div className="divide-y divide-[#0F1E3C]/4">
            {historyItems.map(a => {
              const isOpen = expandedHistory.has(a.id)
              return (
                <div key={a.id}>
                  <button
                    onClick={() => toggleHistory(a.id)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-[#F4F6FB] transition-colors text-left"
                  >
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${DISP_BADGE[a.disposition]}`}>
                      {DISP_LABEL[a.disposition]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3C] truncate">{a.productName}</p>
                      {a.notes && <p className="text-xs text-[#0F1E3C]/40 truncate">{a.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-black text-amber-500">{a.qty} pç</p>
                      <p className="text-[10px] text-[#0F1E3C]/30">{a.color} · {a.size}</p>
                    </div>
                    <p className="text-[10px] text-[#0F1E3C]/30 flex-shrink-0 w-28 text-right">{fmtDate(a.createdAt)}</p>
                    <span className="text-[#0F1E3C]/25 flex-shrink-0">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#0F1E3C]/4 bg-[#F9FAFB] px-8 py-3 flex items-center gap-4">
                      {a.orderNumber && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/50">
                          Ordem: {a.orderNumber}
                        </span>
                      )}
                      {a.notes && <p className="text-xs text-[#0F1E3C]/50 flex-1">{a.notes}</p>}
                      <button
                        onClick={e => { e.stopPropagation(); setEditing(a) }}
                        className="ml-auto text-xs text-[#4361EE] hover:underline font-semibold flex-shrink-0"
                      >
                        Editar destino
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Saída modal */}
      {showSaida && (
        <SaidaModal
          avarias={avarias.filter(a => a.disposition === "pendente")}
          onClose={() => setShowSaida(false)}
          onSave={handleSave}
        />
      )}

      {/* Disposition modal (edit from color block / history) */}
      {editing && (
        <DispositionModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ─── DispositionModal ─────────────────────────────────────────────────────────

const DEST_OPTIONS: { value: Disposition; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "reaproveitado",
    label: "Reaproveitar",
    desc:  "Retorna para produção ou conserto",
    icon:  <RotateCcw size={14} />,
    color: "bg-blue-50 border-blue-200 text-blue-700",
  },
  {
    value: "vendido",
    label: "Vender com desconto",
    desc:  "Registra saída como venda de avaria",
    icon:  <Tag size={14} />,
    color: "bg-amber-50 border-amber-200 text-amber-700",
  },
  {
    value: "descartado",
    label: "Descartar",
    desc:  "Remove permanentemente do inventário",
    icon:  <Trash2 size={14} />,
    color: "bg-red-50 border-red-200 text-red-700",
  },
]

function DispositionModal({
  item, onClose, onSave,
}: {
  item:    AvariaItem
  onClose: () => void
  onSave:  (id: number, disposition: Disposition, notes: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<Disposition>(item.disposition === "pendente" ? "reaproveitado" : item.disposition)
  const [notes, setNotes]       = useState(item.notes ?? "")
  const [saving, setSaving]     = useState(false)

  async function handleConfirm() {
    setSaving(true)
    try { await onSave(item.id, selected, notes) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <p className="font-bold text-[#0F1E3C]">Destinar avaria</p>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {item.productName} · {item.color} {item.size} · {item.qty} pç
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          {DEST_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all text-left ${
                selected === opt.value
                  ? opt.color + " ring-2 ring-offset-1 ring-current"
                  : "border-[#0F1E3C]/10 hover:bg-[#F9FAFB]"
              }`}
            >
              <span className="mt-0.5 flex-shrink-0">{opt.icon}</span>
              <div>
                <p className="text-sm font-bold">{opt.label}</p>
                <p className="text-[11px] opacity-70 mt-0.5">{opt.desc}</p>
              </div>
              {selected === opt.value && <Check size={14} className="ml-auto mt-0.5 flex-shrink-0" />}
            </button>
          ))}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">
              Observação (opcional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ex: conserto de costura, venda para funcionário..."
              className="w-full px-3 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 px-6 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451d1] disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SaidaModal ───────────────────────────────────────────────────────────────

function SaidaModal({
  avarias, onClose, onSave,
}: {
  avarias: AvariaItem[]
  onClose: () => void
  onSave:  (id: number, disposition: Disposition, notes: string) => Promise<void>
}) {
  const [selected,    setSelected]    = useState<AvariaItem | null>(null)
  const [disposition, setDisposition] = useState<Disposition>("reaproveitado")
  const [notes,       setNotes]       = useState("")
  const [saving,      setSaving]      = useState(false)

  async function handleConfirm() {
    if (!selected) return
    setSaving(true)
    try {
      await onSave(selected.id, disposition, notes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Dar Saída</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Selecione a avaria e defina o destino</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {avarias.length === 0 ? (
              <p className="text-sm text-center text-[#0F1E3C]/30 py-10">Nenhuma avaria pendente de destino.</p>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-3">Selecionar avaria</p>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {avarias.map(a => (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                          selected?.id === a.id
                            ? "border-amber-400 bg-amber-50"
                            : "border-[#0F1E3C]/10 hover:bg-[#F9FAFB]"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          selected?.id === a.id ? "border-amber-400 bg-amber-400" : "border-[#0F1E3C]/20"
                        }`}>
                          {selected?.id === a.id && <Check size={9} className="text-white" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[#0F1E3C]">{a.productName}</p>
                          <p className="text-xs text-[#0F1E3C]/40">{a.color} · {a.size} · {a.qty} pç</p>
                        </div>
                        {a.orderNumber && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex-shrink-0">
                            {a.orderNumber}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {selected && (
                  <>
                    <div>
                      <p className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-3">Destino</p>
                      <div className="space-y-2">
                        {DEST_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setDisposition(opt.value)}
                            className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all text-left ${
                              disposition === opt.value
                                ? opt.color + " ring-2 ring-offset-1 ring-current"
                                : "border-[#0F1E3C]/10 hover:bg-[#F9FAFB]"
                            }`}
                          >
                            <span className="mt-0.5 flex-shrink-0">{opt.icon}</span>
                            <div>
                              <p className="text-sm font-bold">{opt.label}</p>
                              <p className="text-[11px] opacity-70 mt-0.5">{opt.desc}</p>
                            </div>
                            {disposition === opt.value && <Check size={14} className="ml-auto mt-0.5 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">
                        Observação (opcional)
                      </label>
                      <textarea
                        rows={2}
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Ex: conserto de costura, venda para funcionário..."
                        className="w-full px-3 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 resize-none"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex gap-3 px-5 pb-5 flex-shrink-0 border-t border-[#0F1E3C]/6 pt-4">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Confirmar Saída
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
