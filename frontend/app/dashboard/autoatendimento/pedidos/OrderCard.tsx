"use client"

import { Phone, Clock, AlertTriangle, FileText } from "lucide-react"
import type { Order } from "./page"

const STATUS_LABEL: Record<string, string> = {
  triagem:       "Triagem",
  em_separacao:  "Em Separação",
  pronto:        "Pronto p/ Retirada",
  concluido:     "Retirado",
  cancelado:     "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:       "bg-amber-50 text-amber-700 border-amber-200",
  em_separacao:  "bg-blue-50 text-blue-700 border-blue-200",
  pronto:        "bg-orange-50 text-orange-700 border-orange-200",
  concluido:     "bg-[#0F1E3C]/5 text-[#0F1E3C]/40 border-[#0F1E3C]/10",
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
  onSetPaidLabel?: (orderId: number, value: boolean) => void
}

export default function OrderCard({ order, onClick, onSetPaidLabel }: Props) {
  const totalQty  = order.items.reduce((s, i) => s + i.qty, 0)
  const isPronto  = order.status === "pronto"
  const isTriagem = order.status === "triagem"
  const isSeparacao = order.status === "em_separacao"
  const aguardandoConfirmacao = isTriagem && !!order.confirmationRequestedAt
  const hasStockAlert = isSeparacao && !!order.stockAlert?.length
  const isAlterado = isSeparacao && order.alterationSent

  function handleSetPaid(e: React.MouseEvent, value: boolean) {
    e.stopPropagation()
    onSetPaidLabel?.(order.id, value)
  }

  const card = (
    <button
      onClick={onClick}
      className={`relative w-full text-left bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all ${
        order.needsAttention
          ? "border-amber-300 hover:border-amber-400"
          : hasStockAlert || isAlterado
          ? "border-red-300 hover:border-red-400"
          : "border-[#0F1E3C]/8 hover:border-[#4361EE]/30"
      }`}
    >
      {/* Alterado — item mudou manualmente em Separação */}
      {isAlterado && (
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
          <p className="text-[10px] font-bold text-red-700">🔁 Alterado — precisa reconfirmar</p>
        </div>
      )}

      {/* Stock alert banner — só informativo, não muda o pedido sozinho */}
      {hasStockAlert && (
        <div className="mb-3 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-[10px] font-bold text-amber-700 mb-0.5">⚠ Estoque insuficiente</p>
          {order.stockAlert!.map((a, i) => (
            <p key={i} className="text-[10px] text-amber-700">
              {[a.productName, a.color, a.size].filter(Boolean).join(" ")} — pediu {a.requested}, disponível {a.available}
            </p>
          ))}
        </div>
      )}

      {/* Attention banner */}
      {order.needsAttention && !hasStockAlert && (
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
          {/* Sub-estado da Triagem — confirmação ainda não é uma coluna própria */}
          {isTriagem && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              aguardandoConfirmacao ? "bg-purple-50 text-purple-600 border border-purple-200" : "bg-[#4361EE]/10 text-[#4361EE]"
            }`}>
              {aguardandoConfirmacao ? "⏳ Aguard. confirmação" : "Novo"}
            </span>
          )}
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
        <span className="font-semibold text-[#0F1E3C]/60">{totalQty} un total</span>
      </div>

      {order.fiscalNoteStatus && (
        <div className={`mt-2 flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg ${
          order.fiscalNoteStatus === "autorizada" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
        }`}>
          <FileText size={10} />
          {order.fiscalNoteStatus === "autorizada" ? "NFe emitida" : "NFe processando"}
        </div>
      )}

      {/* Selo Pagou/Não pagou — só informativo, Pronto p/ Retirada */}
      {isPronto && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={e => handleSetPaid(e, true)}
            className={`flex-1 text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${
              order.paidLabel === true
                ? "bg-emerald-500 text-white border-emerald-500"
                : "bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50"
            }`}
          >
            Pagou
          </button>
          <button
            onClick={e => handleSetPaid(e, false)}
            className={`flex-1 text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${
              order.paidLabel === false
                ? "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                : "bg-white text-[#0F1E3C]/50 border-[#0F1E3C]/12 hover:bg-[#0F1E3C]/4"
            }`}
          >
            Não pagou
          </button>
        </div>
      )}
    </button>
  )

  if (!isTriagem || aguardandoConfirmacao) return card

  return (
    <div className="led-wrap">
      <div className="led-glow" />
      <div className="led-ring">{card}</div>
    </div>
  )
}
