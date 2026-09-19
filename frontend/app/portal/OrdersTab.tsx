"use client"

import { useEffect, useState } from "react"
import { Package, FileText, Clock } from "lucide-react"

type OrderItem = { productName: string; color: string | null; size: string | null; qty: number; unitPrice: number | null }
type Order = {
  id: number; number: string; status: string; source: string
  totalValue: number | null; paymentMethod: string | null; paidAt: string | null; dueDate: string | null
  createdAt: string; fiscalNoteId: number | null; fiscalNoteStatus: string | null; items: OrderItem[]
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  triagem:       { label: "Em análise",         cls: "bg-amber-50 text-amber-700" },
  em_separacao:  { label: "Em separação",       cls: "bg-blue-50 text-blue-700" },
  pronto:        { label: "Pronto p/ retirada", cls: "bg-orange-50 text-orange-700" },
  concluido:     { label: "Concluído",          cls: "bg-emerald-50 text-emerald-700" },
  cancelado:     { label: "Cancelado",          cls: "bg-red-50 text-red-700" },
}

function fmtR(v: number | null) {
  return `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR")
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/portal/orders")
      .then((r) => r.json())
      .then(setOrders)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-[#0F1E3C]/40">Carregando...</p>

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
        <Package size={26} />
        <p className="text-sm">Você ainda não tem pedidos.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const status = STATUS_LABEL[o.status] ?? { label: o.status, cls: "bg-[#0F1E3C]/5 text-[#0F1E3C]/60" }
        return (
          <div key={o.id} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-sm font-bold text-[#0F1E3C]">Pedido {o.number}</p>
                <p className="text-xs text-[#0F1E3C]/40 flex items-center gap-1 mt-0.5">
                  <Clock size={11} /> {fmtDate(o.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-base font-black text-[#0F1E3C]">{fmtR(o.totalValue)}</p>
                <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${status.cls}`}>{status.label}</span>
              </div>
            </div>

            {o.paymentMethod === "prazo" && (
              <p className="text-[11px] text-[#0F1E3C]/45 mb-2">Prazo combinado com a loja — a data é confirmada na entrega.</p>
            )}

            <div className="border-t border-[#0F1E3C]/6 pt-2.5 space-y-1">
              {o.items.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-[#0F1E3C]/60">
                    {it.qty}x {it.productName}{[it.color, it.size].filter(Boolean).length ? ` (${[it.color, it.size].filter(Boolean).join(", ")})` : ""}
                  </span>
                  <span className="text-[#0F1E3C]/40">{fmtR(Number(it.unitPrice ?? 0) * it.qty)}</span>
                </div>
              ))}
            </div>

            {o.fiscalNoteStatus === "autorizada" && o.fiscalNoteId && (
              <a
                href={`/api/portal/notas/${o.fiscalNoteId}?type=pdf`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4361EE] hover:underline mt-3"
              >
                <FileText size={13} /> Ver nota fiscal
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
