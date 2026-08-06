"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  RefreshCw, CheckCircle, AlertCircle, Clock, DollarSign,
  Plus, X, Loader2, Search, TrendingDown, ChevronUp, ChevronDown,
  Banknote, CreditCard, Smartphone, ArrowRightLeft, Bell, XCircle,
  History, Receipt, FileDown, Printer, Calendar,
} from "lucide-react"
import { todayBR, subDaysBR, fmtDateOnlyBR } from "@/lib/tz"
import Toggle from "@/components/Toggle"
import ClienteExtratoModal from "./ClienteExtratoModal"

type Contact = { id: number; name: string | null; phone: string; paymentTermEnabled: boolean }

export type Payment = {
  id: number
  kind: "produto" | "dtf"
  orderId: number
  orderNumber: string
  orderTotal: number | null
  contactId: number
  contactName: string | null
  contactPhone: string | null
  amount: number
  method: string | null
  notes: string | null
  createdAt: string
  parcelaNum: number
  totalParcelas: number
}

export type PendingOrder = {
  id: number
  number: string
  status: string
  totalValue: number | null
  amountPaid: number | null
  remaining: number | null
  dueDate: string | null
  createdAt: string
  contactId: number
  contactName: string
  contactPhone: string
  contactJid: string
  kind: "produto" | "dtf"
}

function payUrl(o: PendingOrder)    { return o.kind === "dtf" ? `/api/dtf/pedidos/${o.id}/pay`    : `/api/orders/${o.id}/pay` }
function statusUrl(o: PendingOrder) { return o.kind === "dtf" ? `/api/dtf/pedidos/${o.id}/status` : `/api/orders/${o.id}/status` }

type SortKey = "dueDate" | "totalValue" | "contactName"
type SortDir = "asc" | "desc"

const METHODS = [
  { key: "pix",        label: "Pix",         Icon: Smartphone      },
  { key: "dinheiro",   label: "Dinheiro",    Icon: Banknote        },
  { key: "cartao",     label: "Cartão",      Icon: CreditCard      },
  { key: "transferencia", label: "Transf.",  Icon: ArrowRightLeft  },
]

export function fmtCurrency(val: number | null | undefined) {
  if (val === null || val === undefined) return "—"
  return `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

export function fmtPhone(phone: string | null | undefined) {
  if (!phone) return "—"
  const p = phone.replace(/\D/g, "")
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

export function fmtDateTimeBR(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export const METHOD_LABEL: Record<string, string> = {
  pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", transferencia: "Transferência",
}

function owed(o: PendingOrder) { return o.remaining ?? o.totalValue ?? 0 }

function dueDateStatus(dueDate: string | null, today: string): "vencido" | "hoje" | "futuro" | "sem_data" {
  if (!dueDate) return "sem_data"
  if (dueDate < today) return "vencido"
  if (dueDate === today) return "hoje"
  return "futuro"
}

const DUE_BADGE = {
  vencido:  { label: "Vencido",    cls: "bg-red-100 text-red-700 border-red-200",       dot: "bg-red-500"    },
  hoje:     { label: "Vence hoje", cls: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500"  },
  futuro:   { label: "",           cls: "",                                               dot: "bg-emerald-400"},
  sem_data: { label: "Sem data",   cls: "bg-gray-100 text-gray-500 border-gray-200",    dot: "bg-gray-300"   },
}

type Tab = "pendentes" | "historico"
type HistPreset = "7d" | "30d" | "mes_atual" | "tudo" | "range"

const HIST_PRESETS: { key: HistPreset; label: string }[] = [
  { key: "7d",        label: "7 dias"    },
  { key: "30d",       label: "30 dias"   },
  { key: "mes_atual", label: "Mês atual" },
  { key: "tudo",      label: "Tudo"      },
  { key: "range",     label: "Período"   },
]

function histPresetDates(key: HistPreset, rs: string, re: string): [string, string] | null {
  const t = todayBR()
  if (key === "7d")  return [subDaysBR(6), t]
  if (key === "30d") return [subDaysBR(29), t]
  if (key === "mes_atual") {
    const [y, m] = t.split("-").map(Number)
    return [`${y}-${String(m).padStart(2, "0")}-01`, t]
  }
  if (key === "tudo") return null
  return (rs && re) ? [rs, re] : null
}

export default function ClientesAReceberPage() {
  const [tab,       setTab]       = useState<Tab>("pendentes")
  const [orders,    setOrders]    = useState<PendingOrder[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState("all")
  const [search,    setSearch]    = useState("")
  const [sort,      setSort]      = useState<{ key: SortKey; dir: SortDir }>({ key: "dueDate", dir: "asc" })
  const [baixa,     setBaixa]     = useState<PendingOrder | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [canceling, setCanceling] = useState<PendingOrder | null>(null)
  const [extrato,   setExtrato]   = useState<{ id: number; name: string | null; phone: string | null } | null>(null)

  // ── Histórico de pagamentos (só prazo/parcelado, receivable_payments) ──────
  const [payments,     setPayments]     = useState<Payment[]>([])
  const [histLoading,  setHistLoading]  = useState(false)
  const [histPreset,   setHistPreset]   = useState<HistPreset>("30d")
  const [histFrom,     setHistFrom]     = useState("")
  const [histTo,       setHistTo]       = useState("")

  const today    = todayBR()
  const weekAhead = subDaysBR(-7)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clientes-a-receber")
      setOrders(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const histRange = histPresetDates(histPreset, histFrom, histTo)

  const loadHistorico = useCallback(async () => {
    setHistLoading(true)
    try {
      const params = new URLSearchParams()
      if (histRange) { params.set("from", histRange[0]); params.set("to", histRange[1]) }
      if (search.trim()) params.set("q", search.trim())
      const res = await fetch(`/api/clientes-a-receber/historico?${params}`)
      setPayments(await res.json())
    } finally { setHistLoading(false) }
  }, [histRange?.[0], histRange?.[1], search])

  useEffect(() => { if (tab === "historico") loadHistorico() }, [tab, loadHistorico])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalPending   = orders.reduce((s, o) => s + owed(o), 0)
  const overdueTotal   = orders.filter(o => o.dueDate && o.dueDate < today).reduce((s, o) => s + owed(o), 0)
  const overdueCount   = orders.filter(o => o.dueDate && o.dueDate < today).length
  const todayTotal     = orders.filter(o => o.dueDate === today).reduce((s, o) => s + owed(o), 0)
  const todayCount     = orders.filter(o => o.dueDate === today).length
  const semanaOrders   = orders.filter(o => o.dueDate && o.dueDate > today && o.dueDate <= weekAhead)
  const semanaTotal    = semanaOrders.reduce((s, o) => s + owed(o), 0)
  const semanaCount    = semanaOrders.length

  // ── Filter + Search + Sort ────────────────────────────────────────────────
  const filtered = orders
    .filter(o => {
      if (filter === "vencido") return o.dueDate !== null && o.dueDate < today
      if (filter === "hoje")    return o.dueDate === today
      if (filter === "semana")  return o.dueDate !== null && o.dueDate > today && o.dueDate <= weekAhead
      return true
    })
    .filter(o => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        (o.contactName ?? "").toLowerCase().includes(q) ||
        o.contactPhone.includes(q) ||
        o.number.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1
      if (sort.key === "dueDate") {
        const da = a.dueDate ?? "9999"
        const db = b.dueDate ?? "9999"
        return da < db ? -dir : da > db ? dir : 0
      }
      if (sort.key === "totalValue") {
        return (owed(a) - owed(b)) * dir
      }
      return (a.contactName ?? "").localeCompare(b.contactName ?? "") * dir
    })

  // ── Histórico stats + export ─────────────────────────────────────────────
  const histTotal        = payments.reduce((s, p) => s + p.amount, 0)
  const histByMethod: Record<string, number> = {}
  for (const p of payments) {
    const key = p.method ?? "outro"
    histByMethod[key] = (histByMethod[key] ?? 0) + p.amount
  }

  function exportHistoricoCsv() {
    const header = ["Data", "Cliente", "Telefone", "Pedido", "Valor", "Forma", "Parcela", "Observação"]
    const lines = payments.map(p => [
      fmtDateTimeBR(p.createdAt),
      p.contactName ?? "Sem nome",
      p.contactPhone ?? "",
      p.orderNumber,
      p.amount.toFixed(2).replace(".", ","),
      METHOD_LABEL[p.method ?? ""] ?? p.method ?? "—",
      p.totalParcelas > 1 ? `Parcial ${p.parcelaNum}/${p.totalParcelas}` : "Integral",
      p.notes ?? "",
    ])
    const csv = [header, ...lines]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `historico-pagamentos_${histRange ? `${histRange[0]}_${histRange[1]}` : "tudo"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCancelConfirm(order: PendingOrder) {
    await fetch(statusUrl(order), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelado", actor: "dashboard" }),
    })
    setCanceling(null)
    await load()
  }

  function toggleSort(key: SortKey) {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" }
    )
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sort.key !== col) return <ChevronUp size={12} className="text-[#0F1E3C]/20" />
    return sort.dir === "asc"
      ? <ChevronUp size={12} className="text-[#4361EE]" />
      : <ChevronDown size={12} className="text-[#4361EE]" />
  }

  const FILTERS = [
    { key: "all",     label: "Todos",        count: orders.length },
    { key: "vencido", label: "Vencidos",     count: overdueCount  },
    { key: "hoje",    label: "Hoje",         count: todayCount    },
    { key: "semana",  label: "Próximos 7d",  count: orders.filter(o => o.dueDate && o.dueDate > today && o.dueDate <= weekAhead).length },
  ]

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Clientes a Receber
          </h1>
          <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Cobranças e pedidos com pagamento pendente</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors border border-[#0F1E3C]/8">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={14} /> Nova Cobrança
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold bg-white w-fit">
        <button onClick={() => setTab("pendentes")}
          className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${
            tab === "pendentes" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
          }`}
        >
          <DollarSign size={14} /> Em Aberto
        </button>
        <button onClick={() => setTab("historico")}
          className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${
            tab === "historico" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
          }`}
        >
          <History size={14} /> Histórico
        </button>
      </div>

      {tab === "pendentes" && <>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-[#4361EE]/10 flex items-center justify-center">
              <DollarSign size={14} className="text-[#4361EE]" />
            </div>
            <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Total a Receber</span>
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(totalPending)}</p>
          <p className="text-xs text-[#0F1E3C]/30 mt-1">{orders.length} cobranças pendentes</p>
        </div>

        <div className={`bg-white rounded-2xl border shadow-sm p-5 ${overdueCount > 0 ? "border-red-200 bg-red-50/30" : "border-[#0F1E3C]/8"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-red-100 flex items-center justify-center">
              <AlertCircle size={14} className="text-red-500" />
            </div>
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wider">Vencidos</span>
          </div>
          <p className="text-2xl font-black text-red-600">{fmtCurrency(overdueTotal)}</p>
          <p className="text-xs text-red-400 mt-1">{overdueCount} {overdueCount === 1 ? "cobrança" : "cobranças"}</p>
        </div>

        <div className={`bg-white rounded-2xl border shadow-sm p-5 ${todayCount > 0 ? "border-amber-200 bg-amber-50/30" : "border-[#0F1E3C]/8"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center">
              <Clock size={14} className="text-amber-500" />
            </div>
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Vencem Hoje</span>
          </div>
          <p className="text-2xl font-black text-amber-600">{fmtCurrency(todayTotal)}</p>
          <p className="text-xs text-amber-500 mt-1">{todayCount} {todayCount === 1 ? "cobrança" : "cobranças"}</p>
        </div>

        <div className={`bg-white rounded-2xl border shadow-sm p-5 ${semanaCount > 0 ? "border-blue-200 bg-blue-50/30" : "border-[#0F1E3C]/8"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-blue-100 flex items-center justify-center">
              <AlertCircle size={14} className="text-blue-500" />
            </div>
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Próximos 7d</span>
          </div>
          <p className="text-2xl font-black text-blue-600">{fmtCurrency(semanaTotal)}</p>
          <p className="text-xs text-blue-500 mt-1">{semanaCount} {semanaCount === 1 ? "cobrança" : "cobranças"}</p>
        </div>
      </div>

      {/* ── Filters + Search ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-semibold bg-white">
          {FILTERS.map(({ key, label, count }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-4 py-2 flex items-center gap-1.5 transition-colors ${
                filter === key ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  filter === key ? "bg-white/20 text-white" : "bg-[#0F1E3C]/8 text-[#0F1E3C]/50"
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-48 max-w-72">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm bg-white text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            placeholder="Buscar cliente ou pedido..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {filtered.length > 0 && (
          <p className="text-xs text-[#0F1E3C]/40 ml-auto">
            {filtered.length} resultado{filtered.length !== 1 ? "s" : ""} · {fmtCurrency(filtered.reduce((s, o) => s + owed(o), 0))}
          </p>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-[#0F1E3C]/30">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <CheckCircle size={40} strokeWidth={1} />
          <p className="text-sm font-medium">Nenhum pagamento pendente</p>
          {search && <p className="text-xs">Tente limpar a busca</p>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_110px_110px_120px_90px_120px] gap-3 px-5 py-3 border-b border-[#0F1E3C]/6 bg-[#F4F6FB] text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">
            <button className="flex items-center gap-1 text-left" onClick={() => toggleSort("contactName")}>
              Cliente <SortIcon col="contactName" />
            </button>
            <span>Pedido</span>
            <button className="flex items-center gap-1" onClick={() => toggleSort("totalValue")}>
              Valor <SortIcon col="totalValue" />
            </button>
            <button className="flex items-center gap-1" onClick={() => toggleSort("dueDate")}>
              Vencimento <SortIcon col="dueDate" />
            </button>
            <span>Status</span>
            <span className="text-right">Ação</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[#0F1E3C]/5">
            {filtered.map(o => {
              const ds = dueDateStatus(o.dueDate, today)
              const badge = DUE_BADGE[ds]
              const rowHighlight =
                ds === "vencido" ? "bg-red-50/40 hover:bg-red-50/60" :
                ds === "hoje"    ? "bg-amber-50/40 hover:bg-amber-50/60" :
                "hover:bg-[#F4F6FB]"

              return (
                <div
                  key={o.id}
                  className={`grid grid-cols-[1fr_110px_110px_120px_90px_120px] gap-3 px-5 py-3.5 items-center transition-colors ${rowHighlight}`}
                >
                  {/* Cliente */}
                  <div className="min-w-0">
                    <button
                      onClick={e => { e.stopPropagation(); setExtrato({ id: o.contactId, name: o.contactName, phone: o.contactPhone }) }}
                      className="font-bold text-[#0F1E3C] text-sm truncate hover:text-[#4361EE] hover:underline text-left"
                      title="Ver extrato do cliente"
                    >
                      {o.contactName || "Sem nome"}
                    </button>
                    <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{fmtPhone(o.contactPhone)}</p>
                  </div>

                  {/* Pedido */}
                  <div>
                    <span className="text-xs font-bold text-[#0F1E3C]/70 bg-[#0F1E3C]/6 px-2 py-1 rounded-lg">{o.number}</span>
                  </div>

                  {/* Valor */}
                  <div>
                    <p className="font-black text-[#0F1E3C]">{fmtCurrency(owed(o))}</p>
                    {(o.amountPaid ?? 0) > 0 && (
                      <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                        {fmtCurrency(o.amountPaid)} pago de {fmtCurrency(o.totalValue)}
                      </p>
                    )}
                  </div>

                  {/* Vencimento */}
                  <div>
                    {o.dueDate ? (
                      <p className={`text-sm font-semibold ${
                        ds === "vencido" ? "text-red-600" :
                        ds === "hoje"    ? "text-amber-600" :
                        "text-[#0F1E3C]/60"
                      }`}>
                        {fmtDateOnlyBR(o.dueDate)}
                      </p>
                    ) : (
                      <p className="text-xs text-[#0F1E3C]/30">—</p>
                    )}
                  </div>

                  {/* Status badge */}
                  <div>
                    {badge.label ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${badge.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Em dia
                      </span>
                    )}
                  </div>

                  {/* Ação */}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setCanceling(o)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#0F1E3C]/12 text-[#0F1E3C]/40 hover:border-red-300 hover:text-red-500 hover:bg-red-50 text-xs font-bold transition-colors"
                    >
                      <X size={11} /> Cancelar
                    </button>
                    <button
                      onClick={() => setBaixa(o)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-xs font-bold transition-colors"
                    >
                      <CheckCircle size={11} /> Dar Baixa
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer summary */}
          <div className="px-5 py-3 border-t border-[#0F1E3C]/6 bg-[#F4F6FB] flex justify-between items-center">
            <p className="text-xs text-[#0F1E3C]/40">{filtered.length} registro{filtered.length !== 1 ? "s" : ""}</p>
            <div className="flex items-center gap-1.5">
              <TrendingDown size={12} className="text-[#0F1E3C]/30" />
              <p className="text-xs font-bold text-[#0F1E3C]/60">
                Total visível: <span className="text-[#0F1E3C]">{fmtCurrency(filtered.reduce((s, o) => s + owed(o), 0))}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      </>}

      {tab === "historico" && <>

      {/* ── Histórico: stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Receipt size={14} className="text-emerald-600" />
            </div>
            <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Recebido no Período</span>
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(histTotal)}</p>
          <p className="text-xs text-[#0F1E3C]/30 mt-1">{payments.length} pagamento{payments.length !== 1 ? "s" : ""}</p>
        </div>

        {METHODS.map(({ key, label, Icon }) => (
          <div key={key} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-xl bg-[#0F1E3C]/6 flex items-center justify-center">
                <Icon size={14} className="text-[#0F1E3C]/50" />
              </div>
              <span className="text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{label}</span>
            </div>
            <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(histByMethod[key] ?? 0)}</p>
          </div>
        ))}
      </div>

      {/* ── Histórico: período + busca + export ────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-semibold bg-white">
          {HIST_PRESETS.map(({ key, label }) => (
            <button key={key} onClick={() => setHistPreset(key)}
              className={`px-3.5 py-2 transition-colors ${
                histPreset === key ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {histPreset === "range" && (
          <div className="flex items-center gap-2 text-xs">
            <Calendar size={13} className="text-[#0F1E3C]/30" />
            <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
              className="border border-[#0F1E3C]/10 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C]" />
            <span className="text-[#0F1E3C]/30">até</span>
            <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
              className="border border-[#0F1E3C]/10 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C]" />
          </div>
        )}

        <div className="relative flex-1 min-w-48 max-w-72">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm bg-white text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            placeholder="Buscar cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <button
          onClick={exportHistoricoCsv}
          disabled={payments.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#0F1E3C]/10 text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 text-xs font-bold transition-colors disabled:opacity-40 ml-auto"
        >
          <FileDown size={13} /> Exportar CSV
        </button>
      </div>

      {/* ── Histórico: tabela ───────────────────────────────────────────────── */}
      {histLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-[#0F1E3C]/30">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <History size={40} strokeWidth={1} />
          <p className="text-sm font-medium">Nenhum pagamento registrado nesse período</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[110px_1fr_100px_90px_110px_120px] gap-3 px-5 py-3 border-b border-[#0F1E3C]/6 bg-[#F4F6FB] text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">
            <span>Data</span>
            <span>Cliente</span>
            <span>Pedido</span>
            <span className="text-right">Valor</span>
            <span>Forma</span>
            <span>Situação</span>
          </div>
          <div className="divide-y divide-[#0F1E3C]/5">
            {payments.map(p => (
              <div key={p.id} className="grid grid-cols-[110px_1fr_100px_90px_110px_120px] gap-3 px-5 py-3.5 items-center hover:bg-[#F4F6FB] transition-colors">
                <p className="text-xs text-[#0F1E3C]/60">{fmtDateTimeBR(p.createdAt)}</p>
                <div className="min-w-0">
                  <button
                    onClick={() => setExtrato({ id: p.contactId, name: p.contactName, phone: p.contactPhone })}
                    className="font-bold text-[#0F1E3C] text-sm truncate hover:text-[#4361EE] hover:underline text-left"
                    title="Ver extrato do cliente"
                  >
                    {p.contactName || "Sem nome"}
                  </button>
                </div>
                <span className="text-xs font-bold text-[#0F1E3C]/70 bg-[#0F1E3C]/6 px-2 py-1 rounded-lg w-fit">{p.orderNumber}</span>
                <p className="text-sm font-black text-[#0F1E3C] text-right">{fmtCurrency(p.amount)}</p>
                <p className="text-xs text-[#0F1E3C]/60">{METHOD_LABEL[p.method ?? ""] ?? p.method ?? "—"}</p>
                {p.totalParcelas > 1 ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                    Parcial {p.parcelaNum}/{p.totalParcelas}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
                    Integral
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      </>}

      {/* ── Modal Dar Baixa ──────────────────────────────────────────────────── */}
      {baixa && (
        <DarBaixaModal
          order={baixa}
          onClose={() => setBaixa(null)}
          onSuccess={async () => { setBaixa(null); await load() }}
        />
      )}

      {/* ── Modal Cancelar Cobrança ─────────────────────────────────────────── */}
      {canceling && (
        <CancelarModal
          order={canceling}
          onClose={() => setCanceling(null)}
          onConfirm={() => handleCancelConfirm(canceling)}
        />
      )}

      {/* ── Modal Nova Cobrança ──────────────────────────────────────────────── */}
      {showModal && (
        <NovaCobrancaModal
          onClose={() => setShowModal(false)}
          onSuccess={async () => { setShowModal(false); await load() }}
        />
      )}

      {/* ── Modal Extrato do Cliente ──────────────────────────────────────────── */}
      {extrato && (
        <ClienteExtratoModal
          contactId={extrato.id}
          contactName={extrato.name}
          contactPhone={extrato.phone}
          pending={orders.filter(o => o.contactId === extrato.id)}
          onClose={() => setExtrato(null)}
        />
      )}
    </div>
  )
}

// ─── DarBaixaModal ────────────────────────────────────────────────────────────

function DarBaixaModal({
  order, onClose, onSuccess,
}: {
  order: PendingOrder; onClose: () => void; onSuccess: () => Promise<void>
}) {
  const remaining = owed(order)

  const [method,   setMethod]   = useState("pix")
  const [notes,    setNotes]    = useState("")
  const [notify,   setNotify]   = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState("")
  const [valor,    setValor]    = useState(remaining.toFixed(2).replace(".", ","))

  const today = todayBR()
  const ds = dueDateStatus(order.dueDate, today)

  const valorNum   = Number(valor.replace(",", "."))
  const isParcial  = !isNaN(valorNum) && valorNum > 0 && valorNum < remaining - 0.01

  async function confirm() {
    setError("")
    if (isNaN(valorNum) || valorNum <= 0) { setError("Informe um valor válido."); return }
    if (valorNum > remaining + 0.01) { setError(`Valor maior que o restante (${fmtCurrency(remaining)}).`); return }
    setSaving(true)
    try {
      const res = await fetch(payUrl(order), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, notes: notes.trim(), notifyClient: notify, amount: valorNum }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Erro ao confirmar."); return }
      await onSuccess()
    } catch { setError("Erro de conexão.") }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Confirmar Recebimento</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Registre o pagamento e forme de recebimento</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
              <X size={16} />
            </button>
          </div>

          <div className="p-6 space-y-5">

            {/* Order summary */}
            <div className={`rounded-xl p-4 border ${
              ds === "vencido" ? "bg-red-50 border-red-200" :
              ds === "hoje"    ? "bg-amber-50 border-amber-200" :
              "bg-[#F4F6FB] border-[#0F1E3C]/8"
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider">{order.number}</p>
                  <p className="font-bold text-[#0F1E3C] mt-0.5">{order.contactName || "Sem nome"}</p>
                  {order.dueDate && (
                    <p className={`text-xs mt-0.5 font-medium ${
                      ds === "vencido" ? "text-red-600" : ds === "hoje" ? "text-amber-600" : "text-[#0F1E3C]/50"
                    }`}>
                      {ds === "vencido" ? "⚠ Venceu em " : "Vence em "}
                      {fmtDateOnlyBR(order.dueDate)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#0F1E3C]/40">Restante</p>
                  <p className="text-2xl font-black text-[#0F1E3C]">{fmtCurrency(remaining)}</p>
                  {(order.amountPaid ?? 0) > 0 && (
                    <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                      {fmtCurrency(order.amountPaid)} já pago de {fmtCurrency(order.totalValue)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Valor recebido agora */}
            <div>
              <label className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">
                Valor recebido agora
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#0F1E3C]/40 pointer-events-none">R$</span>
                <input
                  type="text" inputMode="decimal"
                  className="w-full border border-[#0F1E3C]/12 rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                  value={valor}
                  onChange={e => setValor(e.target.value.replace(/[^\d,.]/g, ""))}
                />
              </div>
              {isParcial && (
                <p className="text-xs text-amber-600 font-semibold mt-1.5">
                  Pagamento parcial — vai ficar faltando {fmtCurrency(remaining - valorNum)}, vencimento continua {order.dueDate ? fmtDateOnlyBR(order.dueDate) : "o mesmo"}.
                </p>
              )}
            </div>

            {/* Forma de pagamento */}
            <div>
              <label className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">
                Forma de recebimento
              </label>
              <div className="grid grid-cols-4 gap-2">
                {METHODS.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setMethod(key)}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-semibold transition-colors ${
                      method === key
                        ? "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                        : "border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
                    }`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">
                Observação <span className="normal-case text-[#0F1E3C]/30 font-normal">(opcional)</span>
              </label>
              <input
                className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25"
                placeholder="Ex: Pago em 2x, desconto acordado..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {/* Notificar WA */}
            {order.contactJid && (
              <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-[#F4F6FB] border border-[#0F1E3C]/6">
                <Toggle on={notify} onChange={() => setNotify(v => !v)} />
                <div className="flex items-center gap-2 min-w-0">
                  <Bell size={13} className="text-[#0F1E3C]/40 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#0F1E3C]">Notificar cliente via WhatsApp</p>
                    <p className="text-[10px] text-[#0F1E3C]/40">Confirma o recebimento direto no chat</p>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {saving ? "Confirmando..." : isParcial ? "Confirmar Recebimento Parcial" : "Confirmar Recebimento"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── NovaCobrancaModal ────────────────────────────────────────────────────────

function NovaCobrancaModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [search,   setSearch]   = useState("")
  const [selected, setSelected] = useState<Contact | null>(null)
  const [showDrop, setShowDrop] = useState(false)
  const [desc,     setDesc]     = useState("")
  const [value,    setValue]    = useState("")
  const [dueDate,  setDueDate]  = useState("")
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState("")
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/clientes").then(r => r.json()).then(setContacts).catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false)
    }
    if (showDrop) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showDrop])

  const suggestions = contacts.filter(c => {
    const q = search.toLowerCase()
    return (c.name ?? "").toLowerCase().includes(q) || c.phone.includes(q)
  }).slice(0, 8)

  function pickContact(c: Contact) {
    setSelected(c)
    setSearch(c.name ?? c.phone)
    setShowDrop(false)
  }

  const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25"

  async function handleSubmit() {
    setError("")
    if (!selected) return setError("Selecione um cliente.")
    const numVal = Number(value.replace(",", "."))
    if (!numVal || numVal <= 0) return setError("Informe um valor válido.")
    if (!dueDate) return setError("Informe a data de vencimento.")
    setSaving(true)
    try {
      const res = await fetch("/api/clientes-a-receber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: selected.id, description: desc.trim() || "Cobrança manual", totalValue: numVal, dueDate }),
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
              <h2 className="text-base font-bold text-[#0F1E3C]">Nova Cobrança</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Lançamento manual de valor a receber</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>

          <div className="p-6 space-y-4">
            {/* Contact picker */}
            <div>
              <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Cliente *</label>
              <div className="relative" ref={dropRef}>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
                  <input
                    className={inputCls + " pl-8"}
                    placeholder="Buscar por nome ou telefone..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setSelected(null); setShowDrop(true) }}
                    onFocus={() => setShowDrop(true)}
                  />
                </div>
                {showDrop && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#0F1E3C]/10 rounded-xl shadow-lg z-10 overflow-hidden max-h-48 overflow-y-auto">
                    {suggestions.map(c => (
                      <button key={c.id} onClick={() => pickContact(c)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#F4F6FB] text-left transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0F1E3C] truncate">{c.name || "Sem nome"}</p>
                          <p className="text-xs text-[#0F1E3C]/40">{fmtPhone(c.phone)}</p>
                        </div>
                        {c.paymentTermEnabled && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">PRAZO</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selected && <p className="text-xs text-emerald-600 font-semibold mt-1">✓ {selected.name || selected.phone} selecionado</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Descrição</label>
              <input className={inputCls} placeholder="Ex: Pedido blusinhas maio, atacado..." value={desc} onChange={e => setDesc(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Valor *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#0F1E3C]/40 pointer-events-none">R$</span>
                  <input type="text" inputMode="decimal" className={inputCls + " pl-9"} placeholder="0,00"
                    value={value} onChange={e => setValue(e.target.value.replace(/[^\d,.]/g, ""))} />
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
                Criar Cobrança
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── CancelarModal ────────────────────────────────────────────────────────────

function CancelarModal({
  order, onClose, onConfirm,
}: {
  order: PendingOrder; onClose: () => void; onConfirm: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function confirm() {
    setSaving(true)
    try { await onConfirm() } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
            <div className="flex items-center gap-2">
              <XCircle size={18} className="text-red-500" />
              <h2 className="text-base font-bold text-[#0F1E3C]">Cancelar Cobrança</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-xl bg-red-50 border border-red-100 p-4">
              <p className="text-sm font-bold text-[#0F1E3C]">{order.number} · {order.contactName || "Sem nome"}</p>
              <p className="text-xs text-[#0F1E3C]/50 mt-0.5">{fmtCurrency(order.totalValue)}</p>
            </div>
            <p className="text-sm text-[#0F1E3C]/60">
              Tem certeza? O pedido será marcado como <strong>cancelado</strong> e sairá da lista de cobranças.
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                Voltar
              </button>
              <button onClick={confirm} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                {saving ? "Cancelando..." : "Confirmar Cancelamento"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
