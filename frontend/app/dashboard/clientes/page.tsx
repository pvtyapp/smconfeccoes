"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Search, X, RefreshCw, ChevronRight,
  Phone, Calendar, ShoppingBag, DollarSign,
  CheckCircle, Save, User,
} from "lucide-react"

type Contact = {
  id: number
  name: string
  phone: string
  jid: string
  lifecycleState: string
  lastOrderAt: string | null
  paymentTermEnabled: boolean
  paymentTermType: string | null
  paymentTermDays: number | null
  createdAt: string
  orderCount: string
  totalSpent: string
}

type OrderItem = {
  id: number
  productName: string
  color: string
  size: string
  qty: number
  unitPrice: number | null
}

type Order = {
  id: number
  number: string
  status: string
  totalValue: number | null
  dueDate: string | null
  paidAt: string | null
  createdAt: string
  items: OrderItem[] | null
}

const LIFECYCLE_CONFIG: Record<string, { label: string; cls: string }> = {
  new:     { label: "Novo",     cls: "bg-gray-100 text-gray-600" },
  active:  { label: "Ativo",   cls: "bg-green-100 text-green-700" },
  ausente: { label: "Ausente", cls: "bg-amber-100 text-amber-700" },
  curioso: { label: "Curioso", cls: "bg-purple-100 text-purple-700" },
}

const STATUS_LABEL: Record<string, string> = {
  triagem:      "Triagem",
  confirmando:  "Confirmando",
  em_separacao: "Em Separação",
  pronto:       "Pronto",
  cancelado:    "Cancelado",
}

const PERIODS = [
  { value: 7,  label: "7d" },
  { value: 15, label: "15d" },
  { value: 30, label: "30d" },
  { value: 0,  label: "Tudo" },
]

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtCurrency(val: number | string | null) {
  if (val === null || val === undefined) return "—"
  return `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

function fmtPhone(phone: string) {
  const p = phone.replace(/\D/g, "")
  if (p.length === 13) return `+${p.slice(0, 2)} (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

export default function ClientesPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterLifecycle, setFilterLifecycle] = useState("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clientes")
      setContacts(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contacts.filter(c => {
    const matchSearch =
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
    const matchLifecycle =
      filterLifecycle === "all" || c.lifecycleState === filterLifecycle
    return matchSearch && matchLifecycle
  })

  const stats = {
    total:   contacts.length,
    active:  contacts.filter(c => c.lifecycleState === "active").length,
    ausente: contacts.filter(c => c.lifecycleState === "ausente").length,
    curioso: contacts.filter(c => c.lifecycleState === "curioso").length,
  }

  const selected = contacts.find(c => c.id === selectedId) ?? null

  return (
    <div className="flex h-full">
      {/* Main */}
      <div className="flex-1 min-w-0 overflow-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0F1E3C]">Clientes</h1>
            <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Contatos ativos no WhatsApp</p>
          </div>
          <button
            onClick={load}
            className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total",   value: stats.total,   color: "text-[#0F1E3C]" },
            { label: "Ativos",  value: stats.active,  color: "text-green-600" },
            { label: "Ausentes",value: stats.ausente, color: "text-amber-600" },
            { label: "Curiosos",value: stats.curioso, color: "text-purple-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
              <p className="text-xs text-[#0F1E3C]/40 font-medium uppercase tracking-wider">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30 bg-white"
            />
          </div>

          <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium bg-white">
            {[
              { key: "all",     label: "Todos" },
              { key: "active",  label: "Ativos" },
              { key: "ausente", label: "Ausentes" },
              { key: "curioso", label: "Curiosos" },
              { key: "new",     label: "Novos" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterLifecycle(key)}
                className={`px-3 py-2 transition-colors ${
                  filterLifecycle === key
                    ? "bg-[#0F1E3C] text-white"
                    : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/6">
                <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Cliente</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Lifecycle</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Último Pedido</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Total Gasto</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pedidos</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Prazo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-[#0F1E3C]/30 text-sm">
                    Carregando...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-[#0F1E3C]/30 text-sm">
                    Nenhum cliente encontrado
                  </td>
                </tr>
              ) : filtered.map(c => {
                const lc = LIFECYCLE_CONFIG[c.lifecycleState] ?? LIFECYCLE_CONFIG.new
                const isSelected = selectedId === c.id
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(isSelected ? null : c.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[#4361EE]/6"
                        : "hover:bg-[#0F1E3C]/3"
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0F1E3C]">{c.name || "Sem nome"}</p>
                      <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{fmtPhone(c.phone)}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${lc.cls}`}>
                        {lc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[#0F1E3C]/60 text-sm">
                      {fmtDate(c.lastOrderAt)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-[#0F1E3C]">
                      {fmtCurrency(c.totalSpent)}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[#0F1E3C]/60">
                      {c.orderCount}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {c.paymentTermEnabled ? (
                        <span className="text-xs text-green-700 font-medium">
                          {c.paymentTermType === "days"
                            ? `${c.paymentTermDays}d`
                            : "Data fixa"}
                        </span>
                      ) : (
                        <span className="text-xs text-[#0F1E3C]/25">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <ChevronRight
                        size={14}
                        className={`transition-transform ${isSelected ? "rotate-90 text-[#4361EE]" : "text-[#0F1E3C]/20"}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      {selected && (
        <ContactDrawer
          contact={selected}
          onClose={() => setSelectedId(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

function ContactDrawer({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact
  onClose: () => void
  onSaved: () => void
}) {
  const [period, setPeriod] = useState(30)
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  const [termEnabled, setTermEnabled] = useState(contact.paymentTermEnabled)
  const [termType, setTermType] = useState<string>(contact.paymentTermType ?? "days")
  const [termDays, setTermDays] = useState<string>(String(contact.paymentTermDays ?? 7))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch(`/api/clientes/${contact.id}?days=${period}`)
      const data = await res.json()
      setOrders(data.orders ?? [])
    } finally {
      setLoadingOrders(false)
    }
  }, [contact.id, period])

  useEffect(() => { loadOrders() }, [loadOrders])

  async function saveTerm() {
    setSaving(true)
    try {
      await fetch(`/api/clientes/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: termEnabled,
          type: termEnabled ? termType : null,
          days: termEnabled && termType === "days" ? parseInt(termDays) || null : null,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const lc = LIFECYCLE_CONFIG[contact.lifecycleState] ?? LIFECYCLE_CONFIG.new

  const totalOrders = orders.reduce((s, o) => s + (o.totalValue ?? 0), 0)

  return (
    <div className="w-96 border-l border-[#0F1E3C]/8 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#4361EE]/10 flex items-center justify-center">
              <User size={14} className="text-[#4361EE]" />
            </div>
            <div>
              <p className="font-bold text-[#0F1E3C] text-sm leading-tight">{contact.name || "Sem nome"}</p>
              <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{fmtPhone(contact.phone)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 ml-10">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${lc.cls}`}>
              {lc.label}
            </span>
            <span className="text-xs text-[#0F1E3C]/30">
              desde {fmtDate(contact.createdAt)}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Prazo de pagamento */}
        <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-3">
            Prazo de Pagamento
          </p>

          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <div
              onClick={() => setTermEnabled(!termEnabled)}
              className={`w-9 h-5 rounded-full transition-colors relative ${termEnabled ? "bg-[#4361EE]" : "bg-[#0F1E3C]/15"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${termEnabled ? "left-4" : "left-0.5"}`} />
            </div>
            <span className="text-sm text-[#0F1E3C]/70 font-medium">
              {termEnabled ? "Prazo ativo" : "Sem prazo"}
            </span>
          </label>

          {termEnabled && (
            <div className="space-y-2.5 pl-1">
              <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
                {[
                  { val: "days",       label: "Dias corridos" },
                  { val: "fixed_date", label: "Data fixa" },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => setTermType(val)}
                    className={`flex-1 py-2 transition-colors ${
                      termType === val
                        ? "bg-[#0F1E3C] text-white"
                        : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {termType === "days" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={termDays}
                    onChange={e => setTermDays(e.target.value)}
                    className="w-20 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30"
                  />
                  <span className="text-sm text-[#0F1E3C]/50">dias corridos após o pedido</span>
                </div>
              )}
              {termType === "fixed_date" && (
                <p className="text-xs text-[#0F1E3C]/40">
                  A data de vencimento é marcada manualmente no pedido.
                </p>
              )}
            </div>
          )}

          <button
            onClick={saveTerm}
            disabled={saving}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#4361EE] text-white text-xs font-semibold hover:bg-[#3451d1] transition-colors disabled:opacity-60"
          >
            {saved ? <CheckCircle size={12} /> : <Save size={12} />}
            {saved ? "Salvo!" : "Salvar"}
          </button>
        </div>

        {/* Histórico */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">
              Histórico de Compras
            </p>
            <div className="flex rounded-lg border border-[#0F1E3C]/10 overflow-hidden text-[10px] font-semibold">
              {PERIODS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPeriod(value)}
                  className={`px-2.5 py-1 transition-colors ${
                    period === value
                      ? "bg-[#0F1E3C] text-white"
                      : "text-[#0F1E3C]/40 hover:bg-[#0F1E3C]/6"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mini stats */}
          {orders.length > 0 && (
            <div className="flex gap-3 mb-3">
              <div className="flex-1 bg-[#F4F6FB] rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider text-[#0F1E3C]/40 font-semibold">Pedidos</p>
                <p className="text-base font-bold text-[#0F1E3C]">{orders.length}</p>
              </div>
              <div className="flex-1 bg-[#F4F6FB] rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider text-[#0F1E3C]/40 font-semibold">Total</p>
                <p className="text-base font-bold text-[#0F1E3C]">{fmtCurrency(totalOrders)}</p>
              </div>
            </div>
          )}

          {loadingOrders ? (
            <p className="text-xs text-[#0F1E3C]/30 text-center py-8">Carregando...</p>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-[#0F1E3C]/25">
              <ShoppingBag size={28} strokeWidth={1.2} />
              <p className="text-xs">Nenhum pedido no período</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orders.map(o => (
                <OrderRow key={o.id} order={o} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OrderRow({ order }: { order: Order }) {
  const [open, setOpen] = useState(false)
  const itemCount = order.items?.reduce((s, i) => s + i.qty, 0) ?? 0

  const statusColors: Record<string, string> = {
    pronto:       "bg-green-100 text-green-700",
    em_separacao: "bg-blue-100 text-blue-700",
    confirmando:  "bg-purple-100 text-purple-700",
    triagem:      "bg-amber-100 text-amber-700",
    cancelado:    "bg-red-100 text-red-600",
  }

  return (
    <div className="bg-[#F4F6FB] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#0F1E3C]/4 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#0F1E3C] text-sm">{order.number}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[order.status] ?? "bg-gray-100 text-gray-600"}`}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <Calendar size={10} /> {fmtDate(order.createdAt)}
            </span>
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <ShoppingBag size={10} /> {itemCount} un
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-[#0F1E3C] text-sm">{fmtCurrency(order.totalValue)}</p>
          {order.dueDate && !order.paidAt && (
            <p className="text-[10px] text-amber-600 font-medium">
              Vence {fmtDate(order.dueDate)}
            </p>
          )}
          {order.paidAt && (
            <p className="text-[10px] text-green-600 font-medium flex items-center gap-0.5 justify-end">
              <CheckCircle size={9} /> Pago
            </p>
          )}
        </div>
        <ChevronRight
          size={12}
          className={`text-[#0F1E3C]/30 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && order.items && order.items.length > 0 && (
        <div className="border-t border-[#0F1E3C]/6 px-3 py-2 space-y-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-[#0F1E3C]/60">
              <span>{item.productName} {item.color} {item.size}</span>
              <span className="font-semibold text-[#0F1E3C]">
                {item.qty}x
                {item.unitPrice ? ` · ${fmtCurrency(item.unitPrice * item.qty)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
