"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, Phone, ShoppingBag, Clock, CheckCircle, Package, XCircle } from "lucide-react"
import OrderCard from "./OrderCard"
import OrderModal from "./OrderModal"

export type OrderItem = {
  id: number
  productId: string | null
  productName: string
  color: string
  size: string
  qty: number
  qtyConfirmed: number | null
}

export type Order = {
  id: number
  number: string
  status: string
  notes: string | null
  createdAt: string
  updatedAt: string
  contactId: number
  contactName: string
  contactPhone: string
  contactJid: string
  items: OrderItem[]
}

const TABS = [
  { key: "triagem",       label: "Triagem",       icon: Clock,        color: "text-amber-600"  },
  { key: "em_separacao",  label: "Em Separação",  icon: Package,      color: "text-blue-600"   },
  { key: "pronto",        label: "Pronto",         icon: CheckCircle,  color: "text-green-600"  },
  { key: "concluido",     label: "Concluídos",     icon: ShoppingBag,  color: "text-[#0F1E3C]/40" },
]

export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("triagem")
  const [selected, setSelected] = useState<Order | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/orders")
      const data = await res.json()
      setOrders(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const filtered = orders.filter(o => o.status === tab)

  function counts(key: string) {
    return orders.filter(o => o.status === key).length
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-[#0F1E3C]/8">
        <div>
          <h1 className="text-xl font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Pedidos — Autoatendimento
          </h1>
          <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Pedidos recebidos via WhatsApp</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {TABS.map(({ key, label, icon: Icon, color }) => {
          const active = tab === key
          const c = counts(key)
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "bg-[#4361EE] text-white shadow-sm"
                  : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 hover:text-[#0F1E3C]"
              }`}
            >
              <Icon size={14} className={active ? "" : color} />
              {label}
              {c > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  active ? "bg-white/20 text-white" : "bg-[#0F1E3C]/8 text-[#0F1E3C]/60"
                }`}>
                  {c}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-[#0F1E3C]/30 text-sm">
            Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-[#0F1E3C]/25">
            <ShoppingBag size={32} />
            <p className="text-sm">Nenhum pedido aqui</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => setSelected(order)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Order modal */}
      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onRefresh={() => { load(); setSelected(null) }}
        />
      )}
    </div>
  )
}
