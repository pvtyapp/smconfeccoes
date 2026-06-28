"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { ChevronDown, ChevronRight, RefreshCw, X, Loader2, AlertTriangle, PackageOpen, ClipboardList, Calendar, SlidersHorizontal } from "lucide-react"
import type { BalanceRow } from "@/lib/calculations"

type Movement = {
  id: string
  variantId: string
  productName: string
  color: string
  size: string
  sku: string
  type: "in" | "out"
  quantity: number
  reason: string
  notes: string | null
  batchId: string | null
  createdAt: string
}

type OrderGroup = {
  key: string
  items: Movement[]
  category: "entrada" | "saida" | "manutencao"
  productName: string
  netQty: number
  date: string
  notes: string | null
}

type ProductGroup = {
  productId: string
  productName: string
  rows: BalanceRow[]
  totalQty: number
  totalValue: number
  hasCritical: boolean
}

const REASON_LABEL: Record<string, string> = {
  producao: "Produção", entrada_manual: "Entrada manual", devolucao: "Devolução",
  ajuste_positivo: "Ajuste +", saida_manual: "Retirada manual", venda_manual: "Venda",
  perda: "Perda / Defeito", ajuste_negativo: "Ajuste −",
  venda: "Venda", venda_chatbot: "Venda (chatbot)",
  manutencao: "Manutenção",
}

// ─── Timezone helpers (Brasília = UTC-3 fixo) ────────────────────────────────

const BRT_MS = 3 * 60 * 60 * 1000

function brasiliaStartOf(daysAgo: number): Date {
  const nowBRT  = new Date(Date.now() - BRT_MS)
  const midnight = new Date(Date.UTC(
    nowBRT.getUTCFullYear(),
    nowBRT.getUTCMonth(),
    nowBRT.getUTCDate() - daysAgo,
  ))
  return new Date(midnight.getTime() + BRT_MS) // volta pra UTC
}

type FilterMode =
  | { type: "hoje" }
  | { type: "days"; days: number }
  | { type: "range"; from: string; to: string } // "YYYY-MM-DD"

function filterDates(f: FilterMode): { from: Date; to: Date } {
  const now = new Date()
  if (f.type === "hoje")  return { from: brasiliaStartOf(0), to: now }
  if (f.type === "days")  return { from: brasiliaStartOf(f.days), to: now }
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

function fmtCurrency(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

function stockStatus(row: BalanceRow): "zerado" | "critico" | "ok" {
  if (row.currentStock === 0) return "zerado"
  if (row.minStock > 0 && row.currentStock <= row.minStock) return "critico"
  return "ok"
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

// ─── Color block ──────────────────────────────────────────────────────────────

function ColorBlock({ color, variants }: { color: string; variants: BalanceRow[] }) {
  const hasCritical = variants.some(v => stockStatus(v) !== "ok")
  return (
    <div className={`flex-shrink-0 border rounded-2xl overflow-hidden min-w-[172px] ${hasCritical ? "border-orange-200" : "border-[#0F1E3C]/8"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 ${hasCritical ? "bg-orange-50" : "bg-[#F4F6FB]"}`}>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasCritical ? "bg-orange-400" : "bg-emerald-400"}`} />
        <span className="text-sm font-bold text-[#0F1E3C] truncate">{color || "Sem cor"}</span>
      </div>
      <div className="divide-y divide-[#0F1E3C]/6">
        {variants.map(v => {
          const st = stockStatus(v)
          return (
            <div key={v.variantId} className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F1E3C]">{v.size || "—"}</p>
                <p className="text-[10px] font-mono text-[#0F1E3C]/30 truncate">{v.sku}</p>
              </div>
              <span className={`text-lg font-black flex-shrink-0 ${st === "zerado" ? "text-red-500" : st === "critico" ? "text-orange-500" : "text-[#0F1E3C]"}`}>
                {v.currentStock}
              </span>
            </div>
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

export default function EstoquePage() {
  const [balance, setBalance]     = useState<BalanceRow[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [showOrdem, setShowOrdem]         = useState(false)
  const [adjustingGroup, setAdjustingGroup] = useState<ProductGroup | null>(null)
  const [filter, setFilter]       = useState<FilterMode>({ type: "hoje" })
  const [showCal, setShowCal]     = useState(false)
  const [calFrom, setCalFrom]     = useState(todayBRT())
  const [calTo, setCalTo]         = useState(todayBRT())
  const calRef                    = useRef<HTMLDivElement>(null)

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
      const [bRes, mRes] = await Promise.all([
        fetch("/api/stock/balance"),
        fetch("/api/stock/movements"),
      ])
      if (bRes.ok) setBalance(await bRes.json())
      if (mRes.ok) setMovements(await mRes.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const { from: fromDate, to: toDate } = useMemo(() => filterDates(filter), [filter])

  const movementsInPeriod = useMemo(
    () => movements.filter(m => { const d = new Date(m.createdAt); return d >= fromDate && d <= toDate }),
    [movements, fromDate, toDate]
  )

  const stats = useMemo(() => {
    const totalValue = balance.reduce((a, r) => a + r.currentStock * Number(r.costPrice), 0)
    const totalQty   = balance.reduce((a, r) => a + r.currentStock, 0)
    const critical   = balance.filter(r => stockStatus(r) !== "ok").length
    const inPeriod   = movementsInPeriod.filter(m => m.type === "in").reduce((a, m) => a + m.quantity, 0)
    const outPeriod  = movementsInPeriod.filter(m => m.type === "out").reduce((a, m) => a + m.quantity, 0)
    return { totalValue, totalQty, inPeriod, outPeriod, critical }
  }, [balance, movementsInPeriod])

  const periodTag = filterLabel(filter)

  const groups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, { productName: string; rows: BalanceRow[] }>()
    for (const row of balance) {
      if (!map.has(row.productId)) map.set(row.productId, { productName: row.productName, rows: [] })
      map.get(row.productId)!.rows.push(row)
    }
    return [...map.entries()].map(([productId, g]) => ({
      productId,
      productName: g.productName,
      rows: g.rows.sort((a, b) => a.color.localeCompare(b.color)),
      totalQty:    g.rows.reduce((s, r) => s + r.currentStock, 0),
      totalValue:  g.rows.reduce((s, r) => s + r.currentStock * Number(r.costPrice), 0),
      hasCritical: g.rows.some(r => stockStatus(r) !== "ok"),
    }))
  }, [balance])

  const orderGroups = useMemo<OrderGroup[]>(() => {
    const map = new Map<string, Movement[]>()
    for (const m of movementsInPeriod) {
      const key = m.batchId ?? m.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return [...map.entries()]
      .map(([key, items]) => {
        const isMaintenance = items.some(m => m.reason === "manutencao")
        const netQty = items.reduce((s, m) => s + (m.type === "in" ? m.quantity : -m.quantity), 0)
        const category: OrderGroup["category"] =
          isMaintenance ? "manutencao" : items[0].type === "in" ? "entrada" : "saida"
        return {
          key,
          items: items.sort((a, b) => a.color.localeCompare(b.color) || a.size.localeCompare(b.size)),
          category,
          productName: items[0].productName,
          netQty,
          date: items.reduce((latest, m) => m.createdAt > latest ? m.createdAt : latest, items[0].createdAt),
          notes: items.find(m => m.notes)?.notes ?? null,
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [movementsInPeriod])

  function toggleExpand(productId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(productId) ? next.delete(productId) : next.add(productId)
      return next
    })
  }

  function toggleOrder(key: string) {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Estoque</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Controle de entradas e saídas por produto</p>
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
                      type="date"
                      value={calFrom}
                      max={calTo}
                      onChange={e => setCalFrom(e.target.value)}
                      className="w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#0F1E3C]/40 mb-1">Até</label>
                    <input
                      type="date"
                      value={calTo}
                      min={calFrom}
                      max={todayBRT()}
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
            onClick={() => setShowOrdem(true)}
            className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <ClipboardList size={15} /> Ordem de Entrada
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Valor em estoque"  value={fmtCurrency(stats.totalValue)} sub="preço de custo" />
        <StatCard label="Peças em estoque"  value={`${stats.totalQty}`}  sub="total geral" />
        <StatCard label="Entradas período" value={`+${stats.inPeriod}`}  accent="text-emerald-600" sub={periodTag} />
        <StatCard label="Saídas período"   value={`−${stats.outPeriod}`} accent="text-red-500"     sub={periodTag} />
        <StatCard
          label="Crítico / Zerado"
          value={String(stats.critical)}
          accent={stats.critical > 0 ? "text-orange-600" : "text-[#0F1E3C]"}
          sub={stats.critical > 0 ? "variações abaixo do mínimo" : "tudo OK"}
        />
      </div>

      {/* Product list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <PackageOpen size={40} strokeWidth={1.2} />
          <p className="text-sm">Nenhuma variação cadastrada. Ative o controle de estoque nos produtos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(group => {
            const isOpen = expanded.has(group.productId)

            // Group variants by color
            const colorMap = new Map<string, BalanceRow[]>()
            for (const row of group.rows) {
              if (!colorMap.has(row.color)) colorMap.set(row.color, [])
              colorMap.get(row.color)!.push(row)
            }
            const colorGroups = [...colorMap.entries()].sort(([a], [b]) => a.localeCompare(b))

            return (
              <div key={group.productId} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4">
                  {/* Expand area */}
                  <button
                    onClick={() => toggleExpand(group.productId)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className={`w-1.5 h-7 rounded-full flex-shrink-0 ${group.hasCritical ? "bg-orange-400" : "bg-emerald-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#0F1E3C]">{group.productName}</p>
                      <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                        {colorGroups.length} {colorGroups.length === 1 ? "cor" : "cores"} · {group.totalQty} peças · {fmtCurrency(group.totalValue)}
                      </p>
                    </div>
                    {group.hasCritical && <AlertTriangle size={14} className="text-orange-500 flex-shrink-0" />}
                  </button>

                  {/* Actions */}
                  <button
                    onClick={() => setAdjustingGroup(group)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#0F1E3C]/40 hover:text-[#4361EE] hover:bg-[#4361EE]/8 transition-colors flex-shrink-0"
                    title="Ajuste de estoque"
                  >
                    <SlidersHorizontal size={13} /> Editar
                  </button>
                  <button onClick={() => toggleExpand(group.productId)} className="text-[#0F1E3C]/30 flex-shrink-0">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-[#0F1E3C]/6 p-4">
                    <div className="flex gap-3 flex-wrap">
                      {colorGroups.map(([color, variants]) => (
                        <ColorBlock key={color} color={color} variants={variants} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* History — grouped by order */}
      {orderGroups.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-[#0F1E3C]/30" />
              <h2 className="text-sm font-bold text-[#0F1E3C]">Histórico de ordens</h2>
              <span className="text-xs text-[#0F1E3C]/35 bg-[#F4F6FB] px-2 py-0.5 rounded-full">{periodTag}</span>
            </div>
            <span className="text-xs text-[#0F1E3C]/30">{orderGroups.length} ordem(s)</span>
          </div>
          <div className="divide-y divide-[#0F1E3C]/4">
            {orderGroups.map(og => {
              const isOpen = expandedOrders.has(og.key)
              const badgeCls =
                og.category === "manutencao" ? "bg-orange-100 text-orange-700" :
                og.category === "entrada"    ? "bg-emerald-100 text-emerald-700" :
                                               "bg-red-100 text-red-600"
              const badgeLabel =
                og.category === "manutencao" ? "MANUTENÇÃO" :
                og.category === "entrada"    ? "ENTRADA" : "SAÍDA"
              const qtyColor =
                og.category === "manutencao" ? "text-orange-600" :
                og.category === "entrada"    ? "text-emerald-600" : "text-red-500"
              const qtyLabel = og.netQty >= 0 ? `+${og.netQty}` : `${og.netQty}`

              return (
                <div key={og.key}>
                  <button
                    onClick={() => toggleOrder(og.key)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-[#F4F6FB] transition-colors text-left"
                  >
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${badgeCls}`}>
                      {badgeLabel}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3C] truncate">{og.productName}</p>
                      {og.notes && <p className="text-xs text-[#0F1E3C]/40 truncate">{og.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-base font-black ${qtyColor}`}>{qtyLabel} pç</p>
                      <p className="text-[10px] text-[#0F1E3C]/30">{og.items.length} variação(ões)</p>
                    </div>
                    <p className="text-[10px] text-[#0F1E3C]/30 flex-shrink-0 w-28 text-right">{fmtDate(og.date)}</p>
                    <span className="text-[#0F1E3C]/25 flex-shrink-0">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#0F1E3C]/4 bg-[#F9FAFB]">
                      {og.items.map(m => (
                        <div key={m.id} className="flex items-center gap-3 px-8 py-2.5 border-b border-[#0F1E3C]/4 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#0F1E3C] font-medium">
                              {m.color} · {m.size || "—"}
                            </p>
                            <p className="text-[10px] font-mono text-[#0F1E3C]/30">{m.sku}</p>
                          </div>
                          <span className={`text-sm font-black flex-shrink-0 ${m.type === "in" ? "text-emerald-600" : "text-red-500"}`}>
                            {m.type === "in" ? "+" : "−"}{m.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ajuste modal */}
      {adjustingGroup && (
        <AjusteEstoqueModal
          group={adjustingGroup}
          onClose={() => setAdjustingGroup(null)}
          onSuccess={async () => { setAdjustingGroup(null); await load() }}
        />
      )}

      {/* Ordem de Entrada modal */}
      {showOrdem && (
        <OrdemEntradaModal
          balance={balance}
          groups={groups}
          onClose={() => setShowOrdem(false)}
          onSuccess={async () => {
            setShowOrdem(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

// ─── Ajuste de Estoque Modal ─────────────────────────────────────────────────

function AjusteEstoqueModal({
  group,
  onClose,
  onSuccess,
}: {
  group: ProductGroup
  onClose: () => void
  onSuccess: () => Promise<void>
}) {
  const [step, setStep]     = useState<"edit" | "review">("edit")
  const [qtys, setQtys]     = useState<Record<string, string>>(() =>
    Object.fromEntries(group.rows.map(r => [r.variantId, String(r.currentStock)]))
  )
  const [notes, setNotes]   = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState("")

  const changes = group.rows
    .map(r => ({ row: r, newQty: Number(qtys[r.variantId] ?? r.currentStock) }))
    .filter(({ row, newQty }) => newQty !== row.currentStock && !isNaN(newQty) && newQty >= 0)

  function goReview() {
    setError("")
    if (!notes.trim()) { setError("A observação é obrigatória."); return }
    if (changes.length === 0) { setError("Nenhuma quantidade foi alterada."); return }
    setStep("review")
  }

  async function handleConfirm() {
    setSaving(true); setError("")
    const batchId = crypto.randomUUID()
    try {
      for (const { row, newQty } of changes) {
        const delta = newQty - row.currentStock
        await fetch("/api/stock/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId: row.variantId,
            type:      delta > 0 ? "in" : "out",
            quantity:  Math.abs(delta),
            reason:    "manutencao",
            channel:   "manual",
            notes:     notes.trim(),
            batchId,
          }),
        }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Erro") })
      }
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally { setSaving(false) }
  }

  const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] bg-white"

  // Group rows by color for the edit view
  const colorMap = new Map<string, BalanceRow[]>()
  for (const r of group.rows) {
    if (!colorMap.has(r.color)) colorMap.set(r.color, [])
    colorMap.get(r.color)!.push(r)
  }
  const colorGroups = [...colorMap.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Ajuste de Estoque</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{group.productName}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5 text-[10px] font-semibold">
                <span className={step === "edit" ? "text-[#4361EE]" : "text-[#0F1E3C]/25 line-through"}>Editar</span>
                <span className="text-[#0F1E3C]/20">›</span>
                <span className={step === "review" ? "text-[#4361EE]" : "text-[#0F1E3C]/25"}>Resumo</span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* Step: edit */}
            {step === "edit" && (
              <div className="p-5 space-y-4">
                <p className="text-xs text-[#0F1E3C]/40">Altere as quantidades. Deixe igual para não modificar.</p>

                {colorGroups.map(([color, variants]) => (
                  <div key={color}>
                    <p className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">{color || "Sem cor"}</p>
                    <div className="space-y-2">
                      {variants.map(v => {
                        const newQty = Number(qtys[v.variantId] ?? v.currentStock)
                        const changed = newQty !== v.currentStock && !isNaN(newQty)
                        return (
                          <div key={v.variantId} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${changed ? "border-[#4361EE]/30 bg-[#4361EE]/4" : "border-[#0F1E3C]/8"}`}>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[#0F1E3C] text-sm">{v.size || "Único"}</p>
                              <p className="text-[10px] font-mono text-[#0F1E3C]/30">{v.sku}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-[#0F1E3C]/35">atual: <span className="font-bold text-[#0F1E3C]">{v.currentStock}</span></span>
                              {changed && (
                                <span className={`text-xs font-bold ${newQty > v.currentStock ? "text-emerald-600" : "text-red-500"}`}>
                                  {newQty > v.currentStock ? `+${newQty - v.currentStock}` : `${newQty - v.currentStock}`}
                                </span>
                              )}
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={qtys[v.variantId] ?? v.currentStock}
                              onChange={e => setQtys(prev => ({ ...prev, [v.variantId]: e.target.value }))}
                              className="w-20 border border-[#0F1E3C]/15 rounded-xl px-2 py-1.5 text-center font-black text-lg text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                    Observação <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className={inputCls + " resize-none"}
                    rows={2}
                    placeholder="Ex: Contagem física realizada em 21/05, ajuste pós-produção..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={goReview} className="flex-1 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                    Ver resumo →
                  </button>
                </div>
              </div>
            )}

            {/* Step: review */}
            {step === "review" && (
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs text-[#0F1E3C]/40 mb-3">
                    {changes.length} variação(ões) serão ajustadas. Confirme antes de aplicar.
                  </p>
                  <div className="space-y-2">
                    {changes.map(({ row, newQty }) => {
                      const delta = newQty - row.currentStock
                      return (
                        <div key={row.variantId} className="flex items-center justify-between px-4 py-3 bg-[#F4F6FB] rounded-xl">
                          <div>
                            <p className="font-bold text-[#0F1E3C] text-sm">{row.color} · {row.size || "Único"}</p>
                            <p className="text-[10px] font-mono text-[#0F1E3C]/30">{row.sku}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-[#0F1E3C]/50">
                              {row.currentStock} <span className="text-[#0F1E3C]/25">→</span> <span className="font-black text-[#0F1E3C]">{newQty}</span>
                            </p>
                            <p className={`text-sm font-black ${delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                              {delta > 0 ? `+${delta}` : delta}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs font-semibold text-amber-700 mb-0.5">Observação</p>
                  <p className="text-sm text-amber-800">{notes}</p>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

                <div className="flex gap-3">
                  <button onClick={() => { setStep("edit"); setError("") }} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                    ← Voltar
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-colors"
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Confirmar ajuste
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Ordem de Entrada Modal ───────────────────────────────────────────────────

const STEPS = ["Produto", "Quantidades", "Resumo"]

function OrdemEntradaModal({
  balance,
  groups,
  onClose,
  onSuccess,
}: {
  balance: BalanceRow[]
  groups: ProductGroup[]
  onClose: () => void
  onSuccess: () => Promise<void>
}) {
  const [step, setStep]                           = useState(0)
  const [selectedProductId, setSelectedProductId] = useState("")
  const [quantities, setQuantities]               = useState<Record<string, string>>({})
  const [notes, setNotes]                         = useState("")
  const [saving, setSaving]                       = useState(false)
  const [error, setError]                         = useState("")

  const selectedProduct = groups.find(g => g.productId === selectedProductId)

  // All variants for the selected product grouped by color
  const colorGroups = useMemo(() => {
    if (!selectedProductId) return []
    const variants = balance
      .filter(r => r.productId === selectedProductId)
      .sort((a, b) => a.color.localeCompare(b.color))
    const map = new Map<string, BalanceRow[]>()
    for (const v of variants) {
      if (!map.has(v.color)) map.set(v.color, [])
      map.get(v.color)!.push(v)
    }
    return [...map.entries()]
  }, [balance, selectedProductId])

  const summaryItems = useMemo(() => {
    const all = colorGroups.flatMap(([, variants]) => variants)
    return all
      .filter(v => Number(quantities[v.variantId] ?? 0) > 0)
      .map(v => ({ ...v, qty: Number(quantities[v.variantId]) }))
  }, [colorGroups, quantities])

  function pickProduct(productId: string) {
    setSelectedProductId(productId)
    setQuantities({})
    setError("")
    setStep(1)
  }

  async function handleLaunch() {
    if (summaryItems.length === 0) { setError("Informe pelo menos uma quantidade maior que zero."); return }
    setSaving(true); setError("")
    const batchId = crypto.randomUUID()
    try {
      for (const item of summaryItems) {
        const res = await fetch("/api/stock/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId: item.variantId,
            type: "in",
            quantity: item.qty,
            reason: "producao",
            channel: "manual",
            notes: notes || null,
            batchId,
          }),
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      }
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao lançar")
    } finally { setSaving(false) }
  }

  const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] bg-white transition-colors"

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Ordem de Entrada</h2>
              <div className="flex items-center gap-1.5 mt-1">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-semibold ${i === step ? "text-[#4361EE]" : i < step ? "text-[#0F1E3C]/40 line-through" : "text-[#0F1E3C]/20"}`}>
                      {s}
                    </span>
                    {i < STEPS.length - 1 && <span className="text-[#0F1E3C]/15 text-[10px]">›</span>}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">

            {/* Step 0 — Produto */}
            {step === 0 && (
              <div className="p-5">
                <p className="text-xs text-[#0F1E3C]/40 mb-4">Selecione o produto para lançar entrada</p>
                {groups.length === 0 ? (
                  <p className="text-sm text-center text-[#0F1E3C]/30 py-10">Nenhum produto com estoque ativo.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {groups.map(g => (
                      <button
                        key={g.productId}
                        onClick={() => pickProduct(g.productId)}
                        className="p-4 border border-[#0F1E3C]/10 rounded-xl text-left hover:border-[#4361EE] hover:bg-[#F4F6FB] transition-colors group"
                      >
                        <p className="font-bold text-[#0F1E3C] group-hover:text-[#4361EE] transition-colors text-sm leading-snug">{g.productName}</p>
                        <p className="text-xs text-[#0F1E3C]/35 mt-1">{g.totalQty} pç em estoque</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 1 — Quantidades (all colors) */}
            {step === 1 && (
              <div className="p-5 space-y-5">
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">{selectedProduct?.productName}</p>
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Preencha as quantidades de entrada por cor e tamanho</p>
                </div>
                {colorGroups.map(([color, variants]) => (
                  <div key={color}>
                    <p className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">{color || "Sem cor"}</p>
                    <div className="space-y-2">
                      {variants.map(v => {
                        const qty = Number(quantities[v.variantId] ?? 0)
                        return (
                          <div key={v.variantId} className={`flex items-center gap-4 p-3 border rounded-xl transition-colors ${qty > 0 ? "border-emerald-300 bg-emerald-50/40" : "border-[#0F1E3C]/8"}`}>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[#0F1E3C]">{v.size || "Único"}</p>
                              <p className="text-[10px] font-mono text-[#0F1E3C]/30">{v.sku} · atual: {v.currentStock} pç</p>
                            </div>
                            {qty > 0 && (
                              <span className="text-xs font-bold text-emerald-600 flex-shrink-0">→ {v.currentStock + qty} pç</span>
                            )}
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={quantities[v.variantId] ?? ""}
                              onChange={e => setQuantities(prev => ({ ...prev, [v.variantId]: e.target.value }))}
                              className="w-24 border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-center font-black text-xl text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors flex-shrink-0"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <div className="flex gap-3">
                  <button onClick={() => { setStep(0); setError("") }} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                    ← Voltar
                  </button>
                  <button
                    onClick={() => { if (summaryItems.length > 0) { setError(""); setStep(2) } else setError("Informe pelo menos uma quantidade.") }}
                    className="flex-1 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
                  >
                    Revisar →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 — Resumo */}
            {step === 2 && (
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">{selectedProduct?.productName}</p>
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {summaryItems.length} variação(ões) · {summaryItems.reduce((s, i) => s + i.qty, 0)} peças no total
                  </p>
                </div>

                <div className="space-y-2">
                  {summaryItems.map(item => (
                    <div key={item.variantId} className="flex items-center justify-between px-4 py-3 bg-[#F4F6FB] rounded-xl">
                      <div>
                        <p className="font-bold text-[#0F1E3C] text-sm">{item.color} · {item.size || "Único"}</p>
                        <p className="text-[10px] font-mono text-[#0F1E3C]/30">{item.sku} · atual: {item.currentStock} pç</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-black text-emerald-600">+{item.qty}</p>
                        <p className="text-[10px] text-[#0F1E3C]/35">→ {item.currentStock + item.qty} pç</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                    Observação <span className="text-[#0F1E3C]/25">(opcional)</span>
                  </label>
                  <input
                    className={inputCls}
                    placeholder="Ex: Lote jan/2026, produção semanal..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

                <div className="flex gap-3">
                  <button onClick={() => { setError(""); setStep(1) }} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                    ← Voltar
                  </button>
                  <button
                    onClick={handleLaunch}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-colors"
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Lançar Entrada
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
