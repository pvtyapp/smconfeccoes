"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { RefreshCw, CheckCircle, AlertCircle, Clock, DollarSign, Plus, X, Loader2, Search } from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"

type Contact = {
  id: number
  name: string | null
  phone: string
  paymentTermEnabled: boolean
}

type PendingOrder = {
  id: number
  number: string
  status: string
  totalValue: number | null
  dueDate: string | null
  createdAt: string
  contactId: number
  contactName: string
  contactPhone: string
  contactJid: string
}

function fmtDate(iso: string | null) { return fmtDateBR(iso) }

function fmtCurrency(val: number | null) {
  if (val === null || val === undefined) return "—"
  return `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

function fmtPhone(phone: string) {
  const p = phone.replace(/\D/g, "")
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

function dueDateStatus(dueDate: string | null): "vencido" | "hoje" | "futuro" | "sem_data" {
  if (!dueDate) return "sem_data"
  const today = todayBR()
  if (dueDate < today) return "vencido"
  if (dueDate === today) return "hoje"
  return "futuro"
}

const DUE_CONFIG = {
  vencido:  { label: "Vencido",   cls: "bg-red-100 text-red-700",     icon: AlertCircle },
  hoje:     { label: "Vence Hoje",cls: "bg-amber-100 text-amber-700", icon: Clock       },
  futuro:   { label: "",          cls: "",                             icon: Clock       },
  sem_data: { label: "Sem data",  cls: "bg-gray-100 text-gray-500",   icon: Clock       },
}

const FILTER_OPTIONS = [
  { key: "all",     label: "Todos" },
  { key: "vencido", label: "Vencidos" },
  { key: "hoje",    label: "Hoje" },
  { key: "semana",  label: "Próximos 7d" },
]

export default function ClientesAReceberPage() {
  const [orders, setOrders]     = useState<PendingOrder[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState("all")
  const [paying, setPaying]     = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clientes-a-receber")
      setOrders(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function markPaid(orderId: number) {
    setPaying(orderId)
    try {
      await fetch(`/api/orders/${orderId}/pay`, { method: "POST" })
      await load()
    } finally {
      setPaying(null)
    }
  }

  const today = todayBR()
  const weekAhead = subDaysBR(-7)

  const filtered = orders.filter(o => {
    if (filter === "all") return true
    if (filter === "vencido") return o.dueDate !== null && o.dueDate < today
    if (filter === "hoje") return o.dueDate === today
    if (filter === "semana") return o.dueDate !== null && o.dueDate > today && o.dueDate <= weekAhead
    return true
  })

  const totalPending = filtered.reduce((s, o) => s + (o.totalValue ?? 0), 0)
  const overdueCount = orders.filter(o => o.dueDate !== null && o.dueDate < today).length
  const todayCount   = orders.filter(o => o.dueDate === today).length

  // Group by contact
  const grouped: Record<number, { name: string; phone: string; orders: PendingOrder[] }> = {}
  for (const o of filtered) {
    if (!grouped[o.contactId]) {
      grouped[o.contactId] = { name: o.contactName, phone: o.contactPhone, orders: [] }
    }
    grouped[o.contactId].orders.push(o)
  }

  return (
    <div className="p-6 max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F1E3C]">Clientes a Receber</h1>
          <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Pedidos com prazo de pagamento pendente</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={15} /> Nova Cobrança
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
          <p className="text-xs text-[#0F1E3C]/40 font-medium uppercase tracking-wider">Total Pendente</p>
          <p className="text-2xl font-bold text-[#0F1E3C] mt-1">{fmtCurrency(totalPending)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
          <p className="text-xs text-red-500 font-medium uppercase tracking-wider">Vencidos</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{overdueCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
          <p className="text-xs text-amber-600 font-medium uppercase tracking-wider">Vencem Hoje</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{todayCount}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium bg-white w-fit">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 transition-colors ${
              filter === key
                ? "bg-[#0F1E3C] text-white"
                : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <NovaCobrancaModal
          onClose={() => setShowModal(false)}
          onSuccess={async () => { setShowModal(false); await load() }}
        />
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-16 text-[#0F1E3C]/30 text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-[#0F1E3C]/25">
          <CheckCircle size={36} strokeWidth={1.2} />
          <p className="text-sm font-medium">Nenhum pagamento pendente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([, group]) => {
            const groupTotal = group.orders.reduce((s, o) => s + (o.totalValue ?? 0), 0)

            return (
              <div key={group.name} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
                {/* Contact header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#0F1E3C]/6 bg-[#F4F6FB]">
                  <div>
                    <p className="font-bold text-[#0F1E3C] text-sm">{group.name || "Sem nome"}</p>
                    <p className="text-xs text-[#0F1E3C]/40">{fmtPhone(group.phone)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[#0F1E3C]/40 font-medium uppercase tracking-wider">Total</p>
                    <p className="font-bold text-[#0F1E3C]">{fmtCurrency(groupTotal)}</p>
                  </div>
                </div>

                {/* Orders */}
                <div className="divide-y divide-[#0F1E3C]/4">
                  {group.orders.map(o => {
                    const dueStatus = dueDateStatus(o.dueDate)
                    const dueCfg = DUE_CONFIG[dueStatus]
                    const Icon = dueCfg.icon

                    return (
                      <div key={o.id} className="flex items-center gap-4 px-5 py-3.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#0F1E3C] text-sm">{o.number}</span>
                            {dueCfg.label && (
                              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dueCfg.cls}`}>
                                <Icon size={9} />
                                {dueCfg.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-[#0F1E3C]/40">
                            <span>Pedido: {fmtDate(o.createdAt)}</span>
                            {o.dueDate && (
                              <span className={dueStatus === "vencido" ? "text-red-500 font-semibold" : dueStatus === "hoje" ? "text-amber-600 font-semibold" : ""}>
                                Vencimento: {fmtDate(o.dueDate)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="font-bold text-[#0F1E3C]">{fmtCurrency(o.totalValue)}</p>
                          </div>
                          <button
                            onClick={() => markPaid(o.id)}
                            disabled={paying === o.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                          >
                            <DollarSign size={11} />
                            {paying === o.id ? "..." : "Pago"}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── NovaCobrancaModal ────────────────────────────────────────────────────────

function NovaCobrancaModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [contacts,  setContacts]  = useState<Contact[]>([])
  const [search,    setSearch]    = useState("")
  const [selected,  setSelected]  = useState<Contact | null>(null)
  const [showDrop,  setShowDrop]  = useState(false)
  const [desc,      setDesc]      = useState("")
  const [value,     setValue]     = useState("")
  const [dueDate,   setDueDate]   = useState("")
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState("")
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

  async function handleSubmit() {
    setError("")
    if (!selected)             return setError("Selecione um cliente.")
    const numVal = Number(value.replace(",", "."))
    if (!numVal || numVal <= 0) return setError("Informe um valor válido.")
    if (!dueDate)              return setError("Informe a data de vencimento.")

    setSaving(true)
    try {
      const res = await fetch("/api/clientes-a-receber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId:   selected.id,
          description: desc.trim() || "Cobrança manual",
          totalValue:  numVal,
          dueDate,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? "Erro ao criar cobrança.")
        return
      }
      await onSuccess()
    } catch {
      setError("Erro de conexão.")
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] bg-white"

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">

          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
            <div>
              <h2 className="text-base font-bold text-[#0F1E3C]">Nova Cobrança</h2>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Lançamento manual de valor a receber</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">

            {/* Contact picker */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                Cliente <span className="text-red-500">*</span>
              </label>
              <div className="relative" ref={dropRef}>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
                  <input
                    className={inputCls + " pl-8"}
                    placeholder="Buscar por nome ou telefone..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setSelected(null); setShowDrop(true) }}
                    onFocus={() => setShowDrop(true)}
                  />
                </div>
                {showDrop && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#0F1E3C]/10 rounded-xl shadow-lg z-10 overflow-hidden">
                    {suggestions.map(c => (
                      <button
                        key={c.id}
                        onClick={() => pickContact(c)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#F4F6FB] text-left transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0F1E3C] truncate">{c.name || "Sem nome"}</p>
                          <p className="text-xs text-[#0F1E3C]/40">{fmtPhone(c.phone)}</p>
                        </div>
                        {c.paymentTermEnabled && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 flex-shrink-0">PRAZO</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selected && (
                <p className="text-xs text-emerald-600 font-semibold mt-1">✓ {selected.name || selected.phone} selecionado</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                Descrição
              </label>
              <input
                className={inputCls}
                placeholder="Ex: Blusinhas maio, atacado rodada 12..."
                value={desc}
                onChange={e => setDesc(e.target.value)}
              />
            </div>

            {/* Value + Due date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                  Valor <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#0F1E3C]/40 pointer-events-none">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputCls + " pl-9"}
                    placeholder="0,00"
                    value={value}
                    onChange={e => setValue(e.target.value.replace(/[^\d,.]/g, ""))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                  Vencimento <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  className={inputCls}
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-colors"
              >
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
