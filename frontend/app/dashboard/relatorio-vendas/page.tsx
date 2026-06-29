"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { RefreshCw, ChevronRight, ShoppingBag, DollarSign, Package, TrendingUp } from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  productName: string
  color: string | null
  size: string | null
  qty: number
  unitPrice: number | null
  costPrice: number | null
}

type OrderRecord = {
  id: number
  number: string
  source: string
  status: string
  totalValue: string | null
  dueDate: string | null
  paidAt: string | null
  createdAt: string
  contactName: string | null
  contactPhone: string | null
  items: OrderItem[] | null
}

type AvariaRecord = {
  id: number
  productName: string
  color: string | null
  size: string | null
  qty: number
  notes: string | null
  createdAt: string
  orderNumber: string | null
}

type SaleEntry =
  | { kind: "order";  data: OrderRecord  }
  | { kind: "avaria"; data: AvariaRecord }

// ─── Constants ────────────────────────────────────────────────────────────────

type PeriodKey = "hoje" | "ontem" | "7d" | "15d" | "30d" | "60d" | "range"

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "hoje",  label: "Hoje"    },
  { key: "ontem", label: "Ontem"   },
  { key: "7d",    label: "7d"      },
  { key: "15d",   label: "15d"     },
  { key: "30d",   label: "30d"     },
  { key: "60d",   label: "60d"     },
  { key: "range", label: "Período" },
]

const SOURCE_FILTERS = [
  { value: "all",      label: "Todos"    },
  { value: "pdv",      label: "PDV"      },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "manual",   label: "Manual"   },
  { value: "avarias",  label: "Avarias"  },
]

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  pdv:      { label: "PDV",      cls: "bg-blue-100 text-blue-700"   },
  whatsapp: { label: "WhatsApp", cls: "bg-green-100 text-green-700" },
  manual:   { label: "Manual",   cls: "bg-gray-100 text-gray-600"   },
  avaria:   { label: "Avaria",   cls: "bg-amber-100 text-amber-700" },
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  triagem:       { label: "Triagem",    cls: "bg-slate-100 text-slate-500"   },
  em_separacao:  { label: "Separando",  cls: "bg-blue-100 text-blue-600"     },
  pronto:        { label: "Pronto",     cls: "bg-purple-100 text-purple-700" },
  concluido:     { label: "Concluído",  cls: "bg-emerald-100 text-emerald-700" },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) { return fmtDateBR(iso) }

function fmtPhone(phone: string | null) {
  if (!phone) return ""
  const p = phone.replace(/\D/g, "")
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

function isDtf(name: string) { return name.toLowerCase().startsWith("dtf") }

function getPeriodDates(key: PeriodKey, rs: string, re: string): [string, string] | null {
  const t = todayBR()
  switch (key) {
    case "hoje":  return [t, t]
    case "ontem": { const d = subDaysBR(1); return [d, d] }
    case "7d":    return [subDaysBR(6), t]
    case "15d":   return [subDaysBR(14), t]
    case "30d":   return [subDaysBR(29), t]
    case "60d":   return [subDaysBR(59), t]
    case "range": return (rs && re) ? [rs, re] : null
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{label}</p>
        <p className="text-2xl font-black text-[#0F1E3C] mt-0.5 leading-none">{value}</p>
        {sub && <p className="text-[10px] text-[#0F1E3C]/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RelatorioVendasPage() {
  const [period,       setPeriod]       = useState<PeriodKey>("hoje")
  const [rangeStart,   setRangeStart]   = useState("")
  const [rangeEnd,     setRangeEnd]     = useState("")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [orders,       setOrders]       = useState<OrderRecord[]>([])
  const [avarias,      setAvarias]      = useState<AvariaRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const dates = getPeriodDates(period, rangeStart, rangeEnd)
    if (!dates) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from: dates[0], to: dates[1] })
      const res = await fetch(`/api/relatorio-vendas?${params}`)
      const data = await res.json()
      setOrders(Array.isArray(data.orders)  ? data.orders  : [])
      setAvarias(Array.isArray(data.avarias) ? data.avarias : [])
    } finally {
      setLoading(false)
    }
  }, [period, rangeStart, rangeEnd])

  useEffect(() => { load() }, [load])

  // Unified filtered list
  const entries = useMemo<SaleEntry[]>(() => {
    const list: SaleEntry[] = []

    if (sourceFilter !== "avarias") {
      for (const o of orders) {
        if (sourceFilter === "manual" && o.number.startsWith("COB-")) continue
        if (sourceFilter === "all" || o.source === sourceFilter)
          list.push({ kind: "order", data: o })
      }
    }

    if (sourceFilter === "all" || sourceFilter === "avarias") {
      for (const a of avarias)
        list.push({ kind: "avaria", data: a })
    }

    list.sort((a, b) =>
      new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime()
    )
    return list
  }, [orders, avarias, sourceFilter])

  // Stats — counts include all orders shown; monetary values only from concluído
  const stats = useMemo(() => {
    const ords    = entries.filter(e => e.kind === "order").map(e => (e as { kind: "order"; data: OrderRecord }).data)
    const avars   = entries.filter(e => e.kind === "avaria").map(e => (e as { kind: "avaria"; data: AvariaRecord }).data)
    const concluded = ords.filter(o => o.status === "concluido")

    const totalR         = concluded.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
    const pecas          = concluded.reduce((s, o) => s + (o.items ?? []).filter(i => !isDtf(i.productName)).reduce((si, i) => si + i.qty, 0), 0)
    const metros         = concluded.reduce((s, o) => s + (o.items ?? []).filter(i => isDtf(i.productName)).reduce((si, i) => si + i.qty, 0), 0)
    const avarPecas      = avars.reduce((s, a) => s + a.qty, 0)
    const avarProductCount = new Set(avars.map(a => a.productName)).size
    const ticket         = concluded.length > 0 ? totalR / concluded.length : 0

    let custoTotal = 0
    let custoKnown = false
    for (const o of concluded) {
      for (const item of (o.items ?? [])) {
        if (item.costPrice != null) {
          custoTotal += item.costPrice * item.qty
          custoKnown = true
        }
      }
    }
    const lucroTotal  = custoKnown ? totalR - custoTotal : null
    const margemMedia = (custoKnown && totalR > 0) ? ((totalR - custoTotal) / totalR) * 100 : null

    return { totalR, pedidos: ords.length, concludedCount: concluded.length, pecas, metros, avarPecas, avarProductCount, ticket, lucroTotal, margemMedia }
  }, [entries])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F1E3C]">Relatório de Vendas</h1>
          <p className="text-sm text-[#0F1E3C]/40 mt-0.5">PDV · WhatsApp · Manual · Avarias vendidas</p>
        </div>
        <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  period === key
                    ? "bg-[#4361EE] text-white shadow-sm"
                    : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-semibold bg-white">
            {SOURCE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setSourceFilter(value)}
                className={`px-3 py-2 transition-colors ${sourceFilter === value ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {period === "range" && (
          <div className="flex items-center gap-2">
            <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
            <span className="text-xs text-[#0F1E3C]/40">até</span>
            <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
          </div>
        )}
      </div>

      {/* Stats — monetary KPIs only count concluído orders */}
      {sourceFilter === "avarias" ? (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Peças em Avaria" value={String(stats.avarPecas)}
            sub={`${stats.avarProductCount} produto${stats.avarProductCount !== 1 ? "s" : ""}`}
            icon={Package} color="bg-amber-100 text-amber-700" />
          <StatCard label="Entradas registradas" value={String(entries.length)}
            icon={ShoppingBag} color="bg-purple-100 text-purple-700" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Receita Confirmada" value={fmtR(stats.totalR)}
            sub={`${stats.concludedCount} concluído${stats.concludedCount !== 1 ? "s" : ""}`}
            icon={DollarSign}  color="bg-green-100 text-green-700"
          />
          <StatCard
            label="Pedidos no Período" value={String(stats.pedidos)}
            sub={`${stats.concludedCount} concluídos · ${stats.pedidos - stats.concludedCount} em andamento`}
            icon={ShoppingBag} color="bg-blue-100 text-blue-700"
          />
          <StatCard
            label="Peças no Período" value={String(stats.pecas)}
            sub={stats.metros > 0 ? `+ ${stats.metros}m DTF` : "só pedidos concluídos"}
            icon={Package}    color="bg-purple-100 text-purple-700"
          />
          <StatCard
            label="Ticket Médio" value={stats.concludedCount > 0 ? fmtR(stats.ticket) : "—"}
            sub="pedidos concluídos"
            icon={TrendingUp}  color="bg-amber-100 text-amber-700"
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0F1E3C]/6">
              <th className="text-left  px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Data</th>
              <th className="text-left  px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pedido / Produto</th>
              <th className="text-left  px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Cliente</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Canal</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Peças</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pagamento</th>
              <th className="text-right  px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Valor</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0F1E3C]/4">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Carregando...</td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Nenhuma venda no período</td>
              </tr>
            ) : entries.map(entry => {

              /* ── Order row ──────────────────────────────────── */
              if (entry.kind === "order") {
                const o   = entry.data
                const key = `o-${o.id}`
                const isOpen = expanded.has(key)
                const badge  = SOURCE_BADGE[o.source] ?? SOURCE_BADGE.manual
                const pecasRow  = (o.items ?? []).filter(i => !isDtf(i.productName)).reduce((s, i) => s + i.qty, 0)
                const metrosRow = (o.items ?? []).filter(i => isDtf(i.productName)).reduce((s, i) => s + i.qty, 0)
                const pecasLabel = [pecasRow > 0 ? String(pecasRow) : null, metrosRow > 0 ? `${metrosRow}m` : null].filter(Boolean).join(" + ") || "0"
                const hasItems = (o.items ?? []).length > 0

                const isPrazo = !!o.dueDate
                const isPago  = !!o.paidAt
                let pagLabel = "À vista"
                let pagCls   = "text-green-700 bg-green-50"
                if (isPrazo && !isPago) {
                  pagLabel = `Prazo · ${fmtDate(o.dueDate)}`
                  pagCls   = "text-amber-700 bg-amber-50"
                } else if (isPrazo && isPago) {
                  pagLabel = "Prazo · Pago"
                  pagCls   = "text-blue-700 bg-blue-50"
                } else if (o.status !== "concluido") {
                  pagLabel = "—"
                  pagCls   = ""
                }

                const isConcluido  = o.status === "concluido"
                const rowBaseCls   = isConcluido
                  ? (isOpen ? "bg-emerald-50/60" : "bg-emerald-50/30 hover:bg-emerald-50/60")
                  : (isOpen ? "bg-[#4361EE]/4"   : "opacity-60 hover:opacity-80 hover:bg-[#0F1E3C]/3")

                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => hasItems && toggle(key)}
                      className={`transition-all ${hasItems ? "cursor-pointer" : ""} ${rowBaseCls}`}
                    >
                      <td className="px-5 py-3.5 text-xs text-[#0F1E3C]/60 whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-bold text-[#0F1E3C]">{o.number}</p>
                        {(() => { const sb = STATUS_BADGE[o.status]; return sb ? <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span> : null })()}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-semibold text-[#0F1E3C]">{o.contactName || "Balcão"}</p>
                        {o.contactPhone && o.contactPhone !== "00000000000" && (
                          <p className="text-[10px] text-[#0F1E3C]/40">{fmtPhone(o.contactPhone)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3.5 text-center text-xs text-[#0F1E3C]/60">{pecasLabel}</td>
                      <td className="px-4 py-3.5 text-center">
                        {pagLabel !== "—" ? (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${pagCls}`}>{pagLabel}</span>
                        ) : (
                          <span className="text-xs text-[#0F1E3C]/25">—</span>
                        )}
                      </td>
                      <td className={`px-4 py-3.5 text-right font-black whitespace-nowrap ${isConcluido ? "text-[#0F1E3C]" : "text-[#0F1E3C]/40"}`}>
                        {fmtR(o.totalValue)}
                      </td>
                      <td className="px-4 py-3.5">
                        {hasItems && (
                          <ChevronRight size={13} className={`text-[#0F1E3C]/20 transition-transform ${isOpen ? "rotate-90 text-[#4361EE]" : ""}`} />
                        )}
                      </td>
                    </tr>

                    {/* Expanded items */}
                    {isOpen && (
                      <tr key={`${key}-items`}>
                        <td colSpan={8} className="bg-[#F4F6FB] px-10 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[#0F1E3C]/8">
                                <th className="text-left py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Produto</th>
                                <th className="text-left py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Cor</th>
                                <th className="text-left py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Tam.</th>
                                <th className="text-center py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Qtd / m</th>
                                <th className="text-right py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Preço/un</th>
                                <th className="text-right py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Subtotal</th>
                                <th className="text-right py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Custo/un</th>
                                <th className="text-right py-1.5 pr-4 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Lucro</th>
                                <th className="text-right py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#0F1E3C]/35">Margem</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#0F1E3C]/4">
                              {(o.items ?? []).map((item, i) => {
                                const subtotal = item.unitPrice != null ? item.qty * item.unitPrice : null
                                const custo    = item.costPrice != null ? item.costPrice * item.qty : null
                                const lucro    = subtotal != null && custo != null ? subtotal - custo : null
                                const margem   = lucro != null && subtotal != null && subtotal > 0
                                  ? (lucro / subtotal) * 100 : null
                                return (
                                  <tr key={i}>
                                    <td className="py-2 pr-4 font-semibold text-[#0F1E3C]">{item.productName}</td>
                                    <td className="py-2 pr-4 text-[#0F1E3C]/50">{item.color || "—"}</td>
                                    <td className="py-2 pr-4 text-[#0F1E3C]/50">{item.size  || "—"}</td>
                                    <td className="py-2 pr-4 text-center text-[#0F1E3C]/70">
                                      {isDtf(item.productName) ? `${item.qty}m` : item.qty}
                                    </td>
                                    <td className="py-2 pr-4 text-right text-[#0F1E3C]/50">
                                      {item.unitPrice != null ? fmtR(item.unitPrice) : "—"}
                                    </td>
                                    <td className="py-2 pr-4 text-right font-bold text-[#0F1E3C]">
                                      {subtotal != null ? fmtR(subtotal) : "—"}
                                    </td>
                                    <td className="py-2 pr-4 text-right text-[#0F1E3C]/40">
                                      {item.costPrice != null ? fmtR(item.costPrice) : "—"}
                                    </td>
                                    <td className="py-2 pr-4 text-right font-semibold text-emerald-600">
                                      {lucro != null ? fmtR(lucro) : "—"}
                                    </td>
                                    <td className="py-2 text-right font-bold">
                                      {margem != null ? (
                                        <span className={
                                          margem >= 40 ? "text-emerald-600"
                                          : margem >= 20 ? "text-amber-600"
                                          : "text-red-600"
                                        }>
                                          {margem.toFixed(1)}%
                                        </span>
                                      ) : "—"}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              }

              /* ── Avaria row ─────────────────────────────────── */
              const a   = entry.data
              const key = `a-${a.id}`
              const desc = [a.productName, a.color, a.size].filter(Boolean).join(" · ")
              return (
                <tr key={key} className="hover:bg-[#0F1E3C]/3 transition-colors">
                  <td className="px-5 py-3.5 text-xs text-[#0F1E3C]/60 whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                  <td className="px-4 py-3.5">
                    <p className="text-xs font-semibold text-[#0F1E3C]">{desc}</p>
                    {a.orderNumber && (
                      <p className="text-[10px] text-[#0F1E3C]/40">Ref. {a.orderNumber}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[#0F1E3C]/30">—</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_BADGE.avaria.cls}`}>Avaria</span>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-[#0F1E3C]/60">{a.qty}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-[#0F1E3C]/30">—</td>
                  <td className="px-4 py-3.5 text-right text-xs text-[#0F1E3C]/30">—</td>
                  <td className="px-4 py-3.5" />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
