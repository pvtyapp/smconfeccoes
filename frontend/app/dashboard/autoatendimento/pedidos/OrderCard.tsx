"use client"

import { Phone, Clock, AlertTriangle, Printer } from "lucide-react"
import type { Order } from "./page"

const STATUS_LABEL: Record<string, string> = {
  triagem:       "Triagem",
  confirmando:   "Aguard. Confirmação",
  em_separacao:  "Em Separação",
  pago:          "Pago",
  pronto:        "Retirado",
  cancelado:     "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:       "bg-amber-50 text-amber-700 border-amber-200",
  confirmando:   "bg-purple-50 text-purple-700 border-purple-200",
  em_separacao:  "bg-blue-50 text-blue-700 border-blue-200",
  pago:          "bg-green-50 text-green-700 border-green-200",
  pronto:        "bg-[#0F1E3C]/5 text-[#0F1E3C]/40 border-[#0F1E3C]/10",
  cancelado:     "bg-red-50 text-red-600 border-red-200",
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "agora"
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

type Props = {
  order: Order
  onClick: () => void
  onTogglePay?: (orderId: number, currentlyPaid: boolean) => void
}

export default function OrderCard({ order, onClick, onTogglePay }: Props) {
  const totalQty  = order.items.reduce((s, i) => s + i.qty, 0)
  const isEm      = order.status === "em_separacao"

  function handlePayToggle(e: React.MouseEvent) {
    e.stopPropagation()
    onTogglePay?.(order.id, false)
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all ${
        order.needsAttention
          ? "border-amber-300 hover:border-amber-400"
          : order.needsPrint
          ? "border-blue-400 hover:border-blue-500 ring-2 ring-blue-200"
          : "border-[#0F1E3C]/8 hover:border-[#4361EE]/30"
      }`}
    >
      {/* Print indicator */}
      {order.needsPrint && (
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-xl animate-pulse">
          <Printer size={11} className="text-blue-500 flex-shrink-0" />
          <p className="text-[10px] font-semibold text-blue-700">Imprimindo ficha...</p>
        </div>
      )}

      {/* Attention banner */}
      {order.needsAttention && !order.needsPrint && (
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
          <p className="text-[10px] font-semibold text-amber-700">Cliente pediu ajuste — chatbot em contato</p>
        </div>
      )}

      {/* Partial indicator */}
      {order.isPartial && (
        <div className="mb-2 px-2 py-0.5 bg-orange-50 border border-orange-200 rounded-lg inline-block">
          <p className="text-[9px] font-bold text-orange-600">PARCIAL</p>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-bold text-[#0F1E3C]">{order.number}</p>
          <div className="flex items-center gap-1 mt-0.5 text-[#0F1E3C]/45 text-xs">
            <Phone size={10} />
            <span>{order.contactName}</span>
            <span>·</span>
            <span>{order.contactPhone}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-[#0F1E3C]/30">
            <Clock size={9} />
            {timeAgo(order.createdAt)}
          </div>
        </div>
      </div>

      {/* Items preview */}
      <div className="space-y-1">
        {order.items.slice(0, 3).map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-[#0F1E3C]/70 truncate">
              {item.productName}
              {item.color ? ` ${item.color}` : ""}
              {item.size ? ` ${item.size}` : ""}
            </span>
            <span className="font-semibold text-[#0F1E3C] ml-2 flex-shrink-0">{item.qty} un</span>
          </div>
        ))}
        {order.items.length > 3 && (
          <p className="text-[10px] text-[#0F1E3C]/30">+{order.items.length - 3} itens</p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[#0F1E3C]/6 flex justify-between items-center text-xs text-[#0F1E3C]/40">
        <span>{order.items.length} iten{order.items.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#0F1E3C]/60">{totalQty} un total</span>
          {/* Botão PAGO — aparece em Em Separação */}
          {isEm && (
            <button
              onClick={handlePayToggle}
              className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              ✓ PAGO
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
