"use client"

import { useState } from "react"
import { X, Printer, Check, Trash2, Plus, ChevronRight } from "lucide-react"
import type { Order, OrderItem } from "./page"

type Props = {
  order: Order
  onClose: () => void
  onRefresh: () => void
}

const STATUS_FLOW: Record<string, { next: string; label: string; color: string }> = {
  triagem:      { next: "confirmando",  label: "Enviar p/ Confirmar",   color: "bg-purple-600 hover:bg-purple-700" },
  confirmando:  { next: "em_separacao", label: "Confirmar Quantidades", color: "bg-blue-600 hover:bg-blue-700"    },
  em_separacao: { next: "pronto",       label: "Marcar como Pronto",    color: "bg-green-600 hover:bg-green-700"   },
  // pronto é estado final — sem avanço
}

export default function OrderModal({ order, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<OrderItem[]>(order.items.map(i => ({ ...i })))
  const [saving, setSaving] = useState(false)
  const [printFormat, setPrintFormat] = useState<"a4" | "thermal">("a4")
  const [showPrint, setShowPrint] = useState(false)

  const flow = STATUS_FLOW[order.status]

  function updateItem(idx: number, field: keyof OrderItem, value: string | number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function addItem() {
    setItems(prev => [...prev, { id: 0, productId: null, productName: "", color: "", size: "", qty: 1, qtyConfirmed: null }])
  }

  async function saveItems() {
    setSaving(true)
    try {
      await fetch(`/api/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
    } finally {
      setSaving(false)
    }
  }

  async function advanceStatus() {
    if (!flow) return
    setSaving(true)
    try {
      // If confirming quantities, use the confirm endpoint
      if (order.status === "confirmando") {
        await fetch(`/api/orders/${order.id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map(i => ({ id: i.id, qtyConfirmed: i.qtyConfirmed ?? i.qty })) }),
        })
      } else {
        // Save items first, then advance
        await saveItems()
        await fetch(`/api/orders/${order.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: flow.next }),
        })
      }
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  async function cancelOrder() {
    if (!confirm("Cancelar este pedido?")) return
    setSaving(true)
    try {
      await fetch(`/api/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelado", note: "Cancelado pelo operador" }),
      })
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  function handlePrint() {
    setShowPrint(true)
    setTimeout(() => window.print(), 300)
  }

  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h2 className="text-base font-bold text-[#0F1E3C]">{order.number}</h2>
            <p className="text-xs text-[#0F1E3C]/40">{order.contactName} · {order.contactPhone}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        {/* Items editor */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Itens do Pedido</p>
            <button
              onClick={addItem}
              className="flex items-center gap-1 text-xs text-[#4361EE] font-medium hover:underline"
            >
              <Plus size={12} /> Adicionar item
            </button>
          </div>

          {items.map((item, idx) => (
            <div key={idx} className="bg-[#F4F6FB] rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 bg-white border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30"
                  placeholder="Produto"
                  value={item.productName}
                  onChange={e => updateItem(idx, "productName", e.target.value)}
                />
                <button onClick={() => removeItem(idx)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-white border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30"
                  placeholder="Cor"
                  value={item.color}
                  onChange={e => updateItem(idx, "color", e.target.value)}
                />
                <input
                  className="w-20 bg-white border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30"
                  placeholder="Tam."
                  value={item.size}
                  onChange={e => updateItem(idx, "size", e.target.value)}
                />
                <div className="flex flex-col gap-0.5">
                  <input
                    type="number"
                    min={0}
                    className="w-20 bg-white border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] text-center font-semibold focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30"
                    value={item.qty}
                    onChange={e => updateItem(idx, "qty", parseInt(e.target.value) || 0)}
                  />
                  {order.status === "confirmando" && (
                    <input
                      type="number"
                      min={0}
                      className="w-20 bg-white border border-blue-300 rounded-lg px-3 py-1.5 text-xs text-blue-700 text-center font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="Conf."
                      value={item.qtyConfirmed ?? ""}
                      onChange={e => updateItem(idx, "qtyConfirmed", parseInt(e.target.value) || 0)}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Total */}
          <div className="flex justify-end pt-2 text-sm text-[#0F1E3C]/60">
            Total: <span className="font-bold text-[#0F1E3C] ml-1">{totalQty} unidades</span>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="mt-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">Observação:</p>
              <p className="text-xs text-amber-800 mt-0.5">{order.notes}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8 space-y-2">
          {/* Print format selector + print button */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
              <button
                onClick={() => setPrintFormat("a4")}
                className={`px-3 py-2 transition-colors ${printFormat === "a4" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}
              >
                A4
              </button>
              <button
                onClick={() => setPrintFormat("thermal")}
                className={`px-3 py-2 transition-colors ${printFormat === "thermal" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}
              >
                Térmica 80mm
              </button>
            </div>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm font-medium text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 transition-colors"
            >
              <Printer size={14} />
              Imprimir Ficha
            </button>
          </div>

          <div className="flex gap-2">
            {order.status !== "pronto" && order.status !== "cancelado" && (
              <button
                onClick={cancelOrder}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Cancelar
              </button>
            )}

            <button
              onClick={saveItems}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-medium text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 transition-colors"
            >
              Salvar alterações
            </button>

            {flow && (
              <button
                onClick={advanceStatus}
                disabled={saving}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors ${flow.color}`}
              >
                <Check size={14} />
                {flow.label}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Print sheet — only visible when printing */}
      {showPrint && (
        <PrintSheet order={order} items={items} format={printFormat} onDone={() => setShowPrint(false)} />
      )}
    </>
  )
}

function PrintSheet({ order, items, format, onDone }: {
  order: Order
  items: OrderItem[]
  format: "a4" | "thermal"
  onDone: () => void
}) {
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0)
  const date = new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

  if (format === "thermal") {
    return (
      <div className="hidden print:block fixed inset-0 bg-white z-[100] p-0" style={{ width: "80mm", fontSize: "12px", fontFamily: "monospace" }}>
        <style>{`@media print { body * { visibility: hidden; } .print-thermal { visibility: visible !important; position: fixed; top: 0; left: 0; width: 80mm; } @page { size: 80mm auto; margin: 4mm; } }`}</style>
        <div className="print-thermal">
          <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }}>SM CONFECÇÕES</div>
          <div style={{ textAlign: "center", fontSize: "10px", marginBottom: "8px" }}>Av. Santa Cruz 3088</div>
          <div style={{ borderTop: "1px dashed #000", marginBottom: "6px" }} />
          <div style={{ fontWeight: "bold", fontSize: "13px" }}>{order.number}</div>
          <div style={{ fontSize: "10px", marginBottom: "2px" }}>{order.contactName}</div>
          <div style={{ fontSize: "10px", marginBottom: "6px" }}>{order.contactPhone}</div>
          <div style={{ borderTop: "1px dashed #000", marginBottom: "6px" }} />
          {items.map((item, i) => (
            <div key={i} style={{ marginBottom: "3px" }}>
              <span style={{ fontWeight: "bold" }}>{item.qty}x</span> {item.productName} {item.color} {item.size}
            </div>
          ))}
          <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
          <div style={{ fontWeight: "bold" }}>TOTAL: {totalQty} un</div>
          <div style={{ fontSize: "9px", marginTop: "4px" }}>{date}</div>
          <div style={{ height: "16px" }} />
        </div>
        <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
      </div>
    )
  }

  // A4
  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[100] p-8">
      <style>{`@media print { body * { visibility: hidden; } .print-a4 { visibility: visible !important; position: fixed; top: 0; left: 0; right: 0; padding: 32px; } @page { size: A4; margin: 20mm; } }`}</style>
      <div className="print-a4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: "900", letterSpacing: "-0.5px" }}>SM CONFECÇÕES</div>
            <div style={{ fontSize: "11px", color: "#666" }}>Av. Santa Cruz, 3088 · Em frente ao Franca Garden</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>FICHA DE SEPARAÇÃO</div>
            <div style={{ fontSize: "13px", color: "#333", marginTop: "2px" }}>{order.number}</div>
            <div style={{ fontSize: "11px", color: "#666" }}>{date}</div>
          </div>
        </div>

        <div style={{ borderTop: "2px solid #000", marginBottom: "16px" }} />

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "1px" }}>Cliente</div>
          <div style={{ fontSize: "15px", fontWeight: "bold" }}>{order.contactName}</div>
          <div style={{ fontSize: "13px", color: "#333" }}>{order.contactPhone}</div>
        </div>

        <div style={{ borderTop: "1px solid #ccc", marginBottom: "12px" }} />

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ textAlign: "left", paddingBottom: "6px", fontSize: "11px", color: "#666", textTransform: "uppercase" }}>Produto</th>
              <th style={{ textAlign: "left", paddingBottom: "6px", fontSize: "11px", color: "#666", textTransform: "uppercase" }}>Cor</th>
              <th style={{ textAlign: "center", paddingBottom: "6px", fontSize: "11px", color: "#666", textTransform: "uppercase" }}>Tam.</th>
              <th style={{ textAlign: "center", paddingBottom: "6px", fontSize: "11px", color: "#666", textTransform: "uppercase" }}>Qtd.</th>
              <th style={{ textAlign: "center", paddingBottom: "6px", fontSize: "11px", color: "#666", textTransform: "uppercase" }}>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 4px 8px 0", fontWeight: "600" }}>{item.productName}</td>
                <td style={{ padding: "8px 4px" }}>{item.color || "—"}</td>
                <td style={{ padding: "8px 4px", textAlign: "center" }}>{item.size || "—"}</td>
                <td style={{ padding: "8px 4px", textAlign: "center", fontWeight: "bold", fontSize: "15px" }}>{item.qty}</td>
                <td style={{ padding: "8px 4px", textAlign: "center" }}>
                  <div style={{ width: "28px", height: "28px", border: "1.5px solid #999", borderRadius: "4px", margin: "0 auto" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: "2px solid #000", marginTop: "12px", paddingTop: "10px", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ fontSize: "15px" }}>
            <span style={{ color: "#666" }}>Total de unidades: </span>
            <span style={{ fontWeight: "900", fontSize: "18px" }}>{totalQty}</span>
          </div>
        </div>

        <div style={{ marginTop: "48px", display: "flex", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #000", paddingTop: "4px", width: "180px", fontSize: "11px", color: "#666" }}>Assinatura do Separador</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #000", paddingTop: "4px", width: "180px", fontSize: "11px", color: "#666" }}>Data / Hora</div>
          </div>
        </div>
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
