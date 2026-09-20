"use client"

import { useEffect, useMemo, useState } from "react"
import { Package, FileText, Receipt, Clock, ChevronDown, Pencil, ChevronLeft, ChevronRight, AlertTriangle, Wallet, CalendarRange, X } from "lucide-react"
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

const PAGE_SIZE = 20

function fmtR(v: number | null) {
  return `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR")
}
function isPastDue(dueDate: string) {
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return due < today
}

function buildReceipt(o: Order): SaleReceipt {
  return {
    id: o.id,
    number: o.number,
    total: Number(o.totalValue ?? 0),
    paymentMethod: o.paymentMethod ?? "pix",
    // SaleReceipt.dueDate é sempre "YYYY-MM-DD" puro (convenção do PDV, que
    // nasce de <input type="date">) — o.dueDate aqui vem da API como
    // timestamp ISO completo (Date do Postgres virou string no JSON). Sem
    // truncar, o "T12:00:00" que o recibo concatena por cima quebra o
    // parsing e vira Invalid Date.
    dueDate: o.dueDate ? o.dueDate.slice(0, 10) : undefined,
    paidAt: o.paidAt,
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

// Mural de pagamento — qualquer pedido com vencimento em aberto (não pago,
// não cancelado), não só quem escolheu "prazo" no checkout. payment_method
// guarda a ESCOLHA no checkout (pix/prazo) — pedido que fechou pagando Pix
// mas foi concluído na retirada como "a prazo" (Concluir a Prazo, sem Pix
// confirmado ainda) também tem due_date e fica devendo, então também entra
// aqui. Quem realmente é o dono da régua é due_date + paidAt, não a escolha
// original. No prazo (laranja) até a data de vencimento, vencido (vermelho)
// depois dela. Fica no topo de Meus Pedidos, separado da lista completa
// abaixo — resumo do que o cliente deve, não substitui o histórico.
function PaymentMural({ orders }: { orders: Order[] }) {
  const pending = orders.filter((o) => !o.paidAt && o.status !== "cancelado" && o.dueDate)
  if (pending.length === 0) return null

  const overdue = pending.filter((o) => isPastDue(o.dueDate!))
  const emAberto = pending.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
  const vencido = overdue.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)

  const sorted = [...pending].sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())

  return (
    <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={15} className="text-[#0F1E3C]/50" />
        <p className="text-sm font-bold text-[#0F1E3C]">Pagamentos a prazo</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[#F4F6FB] rounded-xl px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0F1E3C]/40">Total em aberto</p>
          <p className="text-lg font-black text-[#0F1E3C] mt-0.5">{fmtR(emAberto)}</p>
        </div>
        <div className={`rounded-xl px-4 py-3 ${vencido > 0 ? "bg-red-50" : "bg-[#F4F6FB]"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${vencido > 0 ? "text-red-500" : "text-[#0F1E3C]/40"}`}>Total vencido</p>
          <p className={`text-lg font-black mt-0.5 ${vencido > 0 ? "text-red-600" : "text-[#0F1E3C]"}`}>{fmtR(vencido)}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.map((o) => {
          const late = isPastDue(o.dueDate!)
          return (
            <div key={o.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border-l-4 ${late ? "border-red-500 bg-red-50/50" : "border-amber-400 bg-amber-50/50"}`}>
              {late ? <AlertTriangle size={13} className="text-red-500 flex-shrink-0" /> : <Clock size={13} className="text-amber-500 flex-shrink-0" />}
              <span className="flex-1 text-xs font-semibold text-[#0F1E3C]">Pedido {o.number}</span>
              <span className={`text-[11px] font-semibold ${late ? "text-red-600" : "text-amber-600"}`}>
                {late ? "Venceu em" : "Vence em"} {fmtDate(o.dueDate!)}
              </span>
              <span className="text-xs font-bold text-[#0F1E3C]">{fmtR(o.totalValue)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null)
  const [editing, setEditing] = useState<Order | null>(null)
  const [page, setPage] = useState(1)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  function load() {
    return fetch("/api/portal/orders")
      .then((r) => r.json())
      .then(setOrders)
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filteredOrders = useMemo(() => {
    if (!dateFrom && !dateTo) return orders
    return orders.filter((o) => {
      const created = o.createdAt.slice(0, 10) // YYYY-MM-DD, comparável direto com <input type=date>
      if (dateFrom && created < dateFrom) return false
      if (dateTo && created > dateTo) return false
      return true
    })
  }, [orders, dateFrom, dateTo])

  useEffect(() => { setPage(1) }, [dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))
  const pageOrders = useMemo(() => filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredOrders, page])

  if (loading) return <p className="text-sm text-[#0F1E3C]/40">Carregando...</p>

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
        <Package size={26} />
        <p className="text-sm">Você ainda não tem pedidos.</p>
      </div>
    )
  }

  const hasDateFilter = !!dateFrom || !!dateTo

  return (
    <div>
      <PaymentMural orders={orders} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <CalendarRange size={14} className="text-[#0F1E3C]/35 flex-shrink-0" />
        <input
          type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Filtrar pedidos a partir desta data"
          className="text-xs text-[#0F1E3C] bg-white border border-[#0F1E3C]/10 rounded-lg px-2.5 py-1.5"
        />
        <span className="text-xs text-[#0F1E3C]/30">até</span>
        <input
          type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          aria-label="Filtrar pedidos até esta data"
          className="text-xs text-[#0F1E3C] bg-white border border-[#0F1E3C]/10 rounded-lg px-2.5 py-1.5"
        />
        {hasDateFilter && (
          <button
            type="button" onClick={() => { setDateFrom(""); setDateTo("") }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F1E3C]/40 hover:text-[#0F1E3C] px-1.5 py-1.5"
          >
            <X size={13} /> Limpar
          </button>
        )}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-14 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
          <Package size={22} />
          <p className="text-sm">Nenhum pedido nesse período.</p>
        </div>
      ) : (
      <div className="space-y-3">
        {pageOrders.map((o) => {
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
      </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-5">
          <button
            type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            aria-label="Página anterior"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p} type="button" onClick={() => setPage(p)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                p === page ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            aria-label="Próxima página"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

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
