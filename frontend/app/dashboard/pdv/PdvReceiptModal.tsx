"use client"

import { useState, useEffect } from "react"
import { X, Printer, Check } from "lucide-react"
import { fmtR } from "@/lib/format"

export type ReceiptItem = {
  key: string
  productName: string
  color: string
  size: string
  qty: number
  metros?: number
  precoPorMetro?: boolean
  unitPrice: number
}

export type SaleReceipt = {
  id: number
  number: string
  total: number
  paymentMethod: string
  dueDate?: string
  notes?: string
  contact: { name: string | null; phone: string | null } | null
  items: ReceiptItem[]
}

type Props = {
  receipt: SaleReceipt
  onClose: () => void
  autoPrint?: boolean
}

const PAY_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  debito: "Débito",
  credito: "Crédito",
  prazo: "Prazo",
}

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—"
  const p = phone.replace(/\D/g, "")
  if (p.length === 13) return `+${p.slice(0,2)} (${p.slice(2,4)}) ${p.slice(4,9)}-${p.slice(9)}`
  if (p.length === 11) return `(${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}`
  return phone
}

export default function PdvReceiptModal({ receipt, onClose, autoPrint }: Props) {
  const [showPrint, setShowPrint] = useState(false)
  const [printFormat, setPrintFormat] = useState<"A4" | "termica">("A4")

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pdv_print_format")
      if (saved === "termica" || saved === "A4") setPrintFormat(saved)
    } catch { /* ignora */ }
  }, [])

  useEffect(() => {
    if (autoPrint) {
      setShowPrint(true)
      setTimeout(() => window.print(), 300)
    }
  }, [autoPrint])

  const clientName  = receipt.contact?.name || "Balcão"
  const clientPhone = receipt.contact?.phone && receipt.contact.phone !== "00000000000"
    ? fmtPhone(receipt.contact.phone)
    : "—"

  const tz       = "America/Sao_Paulo"
  const now      = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })

  function handlePrint() {
    setShowPrint(true)
    setTimeout(() => window.print(), 300)
  }

  const isTermica = printFormat === "termica"

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Check size={15} className="text-emerald-600" />
              <h2 className="text-base font-black text-[#0F1E3C]">{receipt.number}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                Concluído
              </span>
            </div>
            <p className="text-xs text-[#0F1E3C]/40">{clientName} · {clientPhone}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {receipt.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <p className="text-xs text-amber-700"><span className="font-semibold">Obs:</span> {receipt.notes}</p>
            </div>
          )}

          {/* Items */}
          <div className="bg-[#F4F6FB] rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#0F1E3C]/6">
              <p className="text-xs font-bold text-[#0F1E3C] uppercase tracking-wide">Itens vendidos</p>
            </div>
            <div className="divide-y divide-[#0F1E3C]/5">
              {receipt.items.map((item, i) => {
                const lineTotal = item.precoPorMetro
                  ? (item.metros ?? 0) * item.unitPrice
                  : item.qty * item.unitPrice
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#0F1E3C]">{item.productName}</p>
                      {(item.color || item.size) && (
                        <p className="text-[10px] text-[#0F1E3C]/40">{[item.color, item.size].filter(Boolean).join(" · ")}</p>
                      )}
                      <p className="text-[10px] text-[#0F1E3C]/50">
                        {item.precoPorMetro
                          ? `${(item.metros ?? 0).toFixed(2)}m × ${fmtR(item.unitPrice)}/m`
                          : `${item.qty} × ${fmtR(item.unitPrice)}`}
                      </p>
                    </div>
                    <p className="text-sm font-black text-[#0F1E3C] flex-shrink-0">{fmtR(lineTotal)}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Payment + Total */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[#0F1E3C]/40">Pagamento</span>
              <span className="font-semibold text-[#0F1E3C]">{PAY_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod}</span>
            </div>
            {receipt.dueDate && (
              <div className="flex justify-between text-xs">
                <span className="text-[#0F1E3C]/40">Vencimento</span>
                <span className="font-semibold text-amber-600">
                  {new Date(receipt.dueDate + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-[#0F1E3C]/8">
              <span className="text-sm text-[#0F1E3C]/60">Total</span>
              <span className="text-2xl font-black text-[#0F1E3C]">{fmtR(receipt.total)}</span>
            </div>
          </div>

          <button
            onClick={handlePrint}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-medium text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 transition-colors"
          >
            <Printer size={14} /> Imprimir Comprovante
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8">
          <button
            onClick={onClose}
            className="w-full py-3 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-black rounded-xl transition-colors"
          >
            Nova Venda
          </button>
        </div>
      </div>

      {showPrint && (
        <ReceiptPrintSheet
          receipt={receipt}
          clientName={clientName}
          clientPhone={clientPhone}
          printDate={printDate}
          printTime={printTime}
          isTermica={isTermica}
          onDone={() => setShowPrint(false)}
        />
      )}
    </>
  )
}

// ─── Print Sheet ──────────────────────────────────────────────────────────────
// A4 sai em 2 vias (LOJA + CLIENTE) na mesma folha, separadas por linha pontilhada
// pra cortar — mesmo padrão já usado na Ficha de Separação de produção. Térmica
// continua em via única (rolo contínuo, sem sentido duplicar).

function ReceiptPrintSheet({ receipt, clientName, clientPhone, printDate, printTime, isTermica, onDone }: {
  receipt: SaleReceipt
  clientName: string
  clientPhone: string
  printDate: string
  printTime: string
  isTermica: boolean
  onDone: () => void
}) {
  const PAY_LABEL_PRINT: Record<string, string> = {
    dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", prazo: "Prazo",
  }

  // A4 — ≤8 itens: 2 vias na mesma folha (LOJA em cima, CLIENTE embaixo) | >8 itens: 2 páginas
  const splitSheet = receipt.items.length <= 8

  function renderVia(via: "LOJA" | "CLIENTE") {
    const pad = !isTermica && splitSheet ? "6mm 14mm 8mm 14mm" : "14mm 16mm"
    return (
      <div style={{ fontFamily: "'Arial', sans-serif", padding: pad, color: NAVY }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <img src="/smsemfundo.png" alt="SM" style={{ height: !isTermica && splitSheet ? "40px" : "50px", width: "auto", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "18px", fontWeight: "900", lineHeight: 1 }}>SM CONFECÇÕES</div>
            <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
          </div>
          {!isTermica && (
            <div style={{
              border: `1.5px solid ${NAVY}`, borderRadius: "4px",
              padding: "3px 10px", textAlign: "center", flexShrink: 0, marginRight: "8px",
            }}>
              <div style={{ fontSize: "6.5px", letterSpacing: "1.5px", color: NAVY, opacity: 0.6, textTransform: "uppercase" }}>via</div>
              <div style={{ fontSize: "9px", fontWeight: "800", letterSpacing: "1px", color: NAVY, textTransform: "uppercase" }}>{via}</div>
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Comprovante PDV</div>
            <div style={{ fontSize: "15px", fontWeight: "900" }}>{receipt.number}</div>
          </div>
        </div>

        {/* Title bar */}
        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "5px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "8px",
        }}>
          <span style={{ fontWeight: "800", fontSize: "10px", letterSpacing: "1.2px" }}>COMPROVANTE DE VENDA</span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>{printDate} {printTime}</span>
        </div>

        {/* Client */}
        <div style={{
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "6px 8px", marginBottom: "8px", background: NAVY_LIGHT,
          display: "flex", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Cliente</div>
            <div style={{ fontSize: "13px", fontWeight: "800" }}>{clientName}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Telefone</div>
            <div style={{ fontSize: "10px", fontWeight: "600" }}>{clientPhone}</div>
          </div>
        </div>

        {/* Items table */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
          <thead>
            <tr style={{ background: NAVY, color: "white" }}>
              <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "7px", fontWeight: "700" }}>PRODUTO</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "60px" }}>COR / TAM</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "36px" }}>QTD</th>
              <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "7px", fontWeight: "700", width: "60px" }}>UNIT.</th>
              <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "7px", fontWeight: "700", width: "70px" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, i) => {
              const up          = Number(item.unitPrice) || 0
              const lineTotal   = item.precoPorMetro ? (item.metros ?? 0) * up : item.qty * up
              const qtyLabel    = item.precoPorMetro ? `${(item.metros ?? 0).toFixed(2)}m` : String(item.qty)
              const colorSize   = [item.color, item.size].filter(Boolean).join(" / ") || "—"
              const unitLabel   = item.precoPorMetro ? `R$ ${up.toFixed(2).replace(".", ",")}/m` : `R$ ${up.toFixed(2).replace(".", ",")}`
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                  <td style={{ padding: "4px 6px", fontSize: "9px", fontWeight: "600" }}>{item.productName}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px" }}>{colorSize}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "10px", fontWeight: "900" }}>{qtyLabel}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "8.5px" }}>{unitLabel}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "9px", fontWeight: "700" }}>
                    {`R$ ${Number(lineTotal).toFixed(2).replace(".", ",")}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Payment + Total */}
        <div style={{
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "6px 10px", background: NAVY_LIGHT, marginBottom: "10px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Pagamento</div>
            <div style={{ fontSize: "11px", fontWeight: "700" }}>
              {PAY_LABEL_PRINT[receipt.paymentMethod] ?? receipt.paymentMethod}
              {receipt.dueDate && ` · venc. ${new Date(receipt.dueDate + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Total</div>
            <div style={{ fontSize: "18px", fontWeight: "900" }}>
              {`R$ ${receipt.total.toFixed(2).replace(".", ",")}`}
            </div>
          </div>
        </div>

        {receipt.notes && (
          <div style={{ fontSize: "8px", color: "#666", marginBottom: "8px" }}>
            <strong>Obs:</strong> {receipt.notes}
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: "1px dashed #ccc", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>{receipt.number} · {printDate}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[100]">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-receipt, .print-receipt * { visibility: visible !important; }
          .print-receipt { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
          @page { size: ${isTermica ? "80mm 297mm" : "A4"} portrait; margin: 0; }
        }
      `}</style>
      <div className="print-receipt">
        {isTermica ? (
          renderVia("CLIENTE")
        ) : splitSheet ? (
          <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100%" }}>
            <div style={{ borderBottom: "1.5px dashed #bbb", overflow: "hidden" }}>{renderVia("LOJA")}</div>
            <div style={{ overflow: "hidden" }}>{renderVia("CLIENTE")}</div>
          </div>
        ) : (
          <>
            {renderVia("LOJA")}
            <div style={{ pageBreakBefore: "always" }}>{renderVia("CLIENTE")}</div>
          </>
        )}
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
