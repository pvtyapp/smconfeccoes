"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, CheckCircle, AlertCircle, Clock, DollarSign } from "lucide-react"

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

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

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
  const today = new Date().toISOString().split("T")[0]
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
  const [orders, setOrders] = useState<PendingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [paying, setPaying] = useState<number | null>(null)

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

  const today = new Date().toISOString().split("T")[0]
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]

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
        <button
          onClick={load}
          className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
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
