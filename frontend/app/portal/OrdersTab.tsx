"use client"

import { useEffect, useState } from "react"
import { Package, FileText, Receipt, Clock, ChevronDown, Pencil } from "lucide-react"
import PdvReceiptModal, { type SaleReceipt } from "@/app/dashboard/pdv/PdvReceiptModal"
import OrderEditModal from "./OrderEditModal"

type OrderItem = { id: number; productName: string; color: string | null; size: string | null; qty: number; unitPrice: number | null }
type Order = {
  id: number; number: string; status: string; source: string
  totalValue: number | null; paymentMethod: string | null; paidAt: string | null; dueDate: string | null
  createdAt: string; contactName: string | null; contactPhone: string | null
  fiscalNoteId: number | null; fiscalNoteStatus: string | null; items: OrderItem[]
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

function buildReceipt(o: Order): SaleReceipt {
  return {
    id: o.id,
    number: o.number,
    total: Number(o.totalValue ?? 0),
    paymentMethod: o.paymentMethod ?? "pix",
    dueDate: o.dueDate ?? undefined,
    contact: { name: o.contactName, phone: o.contactPhone },
    items: o.items.map((it, i) => ({
      key: `${o.id}-${i}`,
      productName: it.productName,
      color: it.color ?? "",
      size: it.size ?? "",
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice ?? 0),
    })),
  }
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null)
  const [editing, setEditing] = useState<Order | null>(null)

  function load() {
    return fetch("/api/portal/orders")
      .then((r) => r.json())
      .then(setOrders)
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

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
        const isOpen = openId === o.id
        const editable = o.status === "em_separacao"
        return (
          <div key={o.id} className="bg-white border border-[#0F1E3C]/8 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : o.id)}
              aria-expanded={isOpen}
              className="w-full text-left p-5 flex items-start justify-between gap-3"
            >
              <div>
                <p className="text-sm font-bold text-[#0F1E3C]">Pedido {o.number}</p>
                <p className="text-xs text-[#0F1E3C]/40 flex items-center gap-1 mt-0.5">
                  <Clock size={11} /> {fmtDate(o.createdAt)} · {o.items.length} ite{o.items.length === 1 ? "m" : "ns"}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <div className="text-right">
                  <p className="text-base font-black text-[#0F1E3C]">{fmtR(o.totalValue)}</p>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${status.cls}`}>{status.label}</span>
                </div>
                <ChevronDown size={16} className={`text-[#0F1E3C]/30 flex-shrink-0 mt-1 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
            </button>

            {isOpen && (
              <div className="px-5 pb-5 border-t border-[#0F1E3C]/6 pt-3">
                {o.paymentMethod === "prazo" && (
                  <p className="text-[11px] text-[#0F1E3C]/45 mb-2">Prazo combinado com a loja — a data é confirmada na entrega.</p>
                )}

                <div className="space-y-1 mb-3">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-xs">
                      <span className="text-[#0F1E3C]/60">
                        {it.qty}x {it.productName}{[it.color, it.size].filter(Boolean).length ? ` (${[it.color, it.size].filter(Boolean).join(", ")})` : ""}
                      </span>
                      <span className="text-[#0F1E3C]/40">{fmtR(Number(it.unitPrice ?? 0) * it.qty)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {o.fiscalNoteStatus === "autorizada" && o.fiscalNoteId ? (
                    <a
                      href={`/api/portal/notas/${o.fiscalNoteId}?type=pdf`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4361EE] hover:underline"
                    >
                      <FileText size={13} /> Ver nota fiscal
                    </a>
                  ) : (
                    <button
                      type="button" onClick={() => setReceipt(buildReceipt(o))}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4361EE] hover:underline"
                    >
                      <Receipt size={13} /> Baixar recibo
                    </button>
                  )}

                  {editable && (
                    <button
                      type="button" onClick={() => setEditing(o)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
                    >
                      <Pencil size={13} /> Editar ou cancelar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {receipt && <PdvReceiptModal receipt={receipt} onClose={() => setReceipt(null)} autoPrint={false} />}

      {editing && (
        <OrderEditModal
          order={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onCanceled={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
