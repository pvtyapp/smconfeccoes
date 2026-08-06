"use client"

import { useEffect, useState } from "react"
import { X, Loader2, Printer } from "lucide-react"
import { fmtDateOnlyBR } from "@/lib/tz"
import type { PendingOrder, Payment } from "./page"
import { fmtCurrency, fmtPhone, fmtDateTimeBR, METHOD_LABEL } from "./page"
import PrintShell from "@/components/print/PrintShell"
import { printWhenReady } from "@/components/print/print-utils"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

type Props = {
  contactId: number
  contactName: string | null
  contactPhone: string | null
  pending: PendingOrder[]
  onClose: () => void
}

export default function ClienteExtratoModal({ contactId, contactName, contactPhone, pending, onClose }: Props) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showPrint, setShowPrint] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clientes-a-receber/historico?contactId=${contactId}`)
      .then(r => r.json())
      .then(setPayments)
      .finally(() => setLoading(false))
  }, [contactId])

  const totalOwed = pending.reduce((s, o) => s + (o.remaining ?? o.totalValue ?? 0), 0)
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0)

  function handlePrint() {
    setShowPrint(true)
    printWhenReady()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h2 className="text-base font-black text-[#0F1E3C]">{contactName || "Sem nome"}</h2>
            <p className="text-xs text-[#0F1E3C]/40">{fmtPhone(contactPhone)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* Totais */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Em Aberto</p>
              <p className="text-xl font-black text-red-600 mt-1">{fmtCurrency(totalOwed)}</p>
              <p className="text-[10px] text-red-400 mt-0.5">{pending.length} pedido{pending.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Já Pago</p>
              <p className="text-xl font-black text-emerald-700 mt-1">{fmtCurrency(totalPaid)}</p>
              <p className="text-[10px] text-emerald-500 mt-0.5">{payments.length} pagamento{payments.length !== 1 ? "s" : ""}</p>
            </div>
          </div>

          {/* Em aberto */}
          <div>
            <p className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Pedidos em aberto</p>
            {pending.length === 0 ? (
              <p className="text-sm text-[#0F1E3C]/30 py-2">Nada pendente.</p>
            ) : (
              <div className="space-y-2">
                {pending.map(o => (
                  <div key={o.id} className="flex items-center justify-between bg-[#F4F6FB] rounded-xl px-4 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-[#0F1E3C]">{o.number}</p>
                      <p className="text-[10px] text-[#0F1E3C]/40">{o.dueDate ? `Vence ${fmtDateOnlyBR(o.dueDate)}` : "Sem vencimento"}</p>
                    </div>
                    <p className="text-sm font-black text-[#0F1E3C]">{fmtCurrency(o.remaining ?? o.totalValue)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pago */}
          <div>
            <p className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Histórico de pagamentos</p>
            {loading ? (
              <div className="flex items-center gap-2 text-[#0F1E3C]/30 py-2">
                <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Carregando...</span>
              </div>
            ) : payments.length === 0 ? (
              <p className="text-sm text-[#0F1E3C]/30 py-2">Nenhum pagamento registrado ainda.</p>
            ) : (
              <div className="space-y-2">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-[#F4F6FB] rounded-xl px-4 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-[#0F1E3C]">{p.orderNumber}</p>
                      <p className="text-[10px] text-[#0F1E3C]/40">
                        {fmtDateTimeBR(p.createdAt)} · {METHOD_LABEL[p.method ?? ""] ?? p.method ?? "—"}
                        {p.totalParcelas > 1 ? ` · Parcial ${p.parcelaNum}/${p.totalParcelas}` : " · Integral"}
                      </p>
                    </div>
                    <p className="text-sm font-black text-emerald-700">{fmtCurrency(p.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8">
          <button
            onClick={handlePrint}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-black rounded-xl transition-colors"
          >
            <Printer size={14} /> Imprimir / Gerar Extrato
          </button>
        </div>
      </div>

      {showPrint && (
        <ExtratoPrintSheet
          contactName={contactName}
          contactPhone={contactPhone}
          pending={pending}
          payments={payments}
          onDone={() => setShowPrint(false)}
        />
      )}
    </>
  )
}

// ─── Print Sheet ──────────────────────────────────────────────────────────────
// Via única (não são 2 vias LOJA/CLIENTE) — este documento é feito pra ser
// mandado pro próprio cliente conferir, não um comprovante interno de balcão.

const thL: React.CSSProperties = { padding: "5px 8px", textAlign: "left",  fontSize: "8px", fontWeight: 700, color: "#666", textTransform: "uppercase" }
const thR: React.CSSProperties = { padding: "5px 8px", textAlign: "right", fontSize: "8px", fontWeight: 700, color: "#666", textTransform: "uppercase" }
const tdL: React.CSSProperties = { padding: "5px 8px", textAlign: "left",  fontSize: "10px" }
const tdR: React.CSSProperties = { padding: "5px 8px", textAlign: "right", fontSize: "10px", fontWeight: 700 }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: NAVY, color: "white", borderRadius: "4px", padding: "6px 12px", margin: "14px 0 6px" }}>
      <span style={{ fontWeight: 800, fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>{children}</span>
    </div>
  )
}

function ExtratoPrintSheet({ contactName, contactPhone, pending, payments, onDone }: {
  contactName: string | null
  contactPhone: string | null
  pending: PendingOrder[]
  payments: Payment[]
  onDone: () => void
}) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const emitDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })

  const totalOwed = pending.reduce((s, o) => s + (o.remaining ?? o.totalValue ?? 0), 0)
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0)

  return (
    <PrintShell wrapperClass="print-extrato" pageMargin="14mm 16mm" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", color: NAVY }}>

        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "50px", width: "auto", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "19px", fontWeight: 900, letterSpacing: "-0.5px", lineHeight: 1 }}>SM CONFECÇÕES</div>
            <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Emitido em</div>
            <div style={{ fontSize: "12px", fontWeight: 800 }}>{emitDate}</div>
          </div>
        </div>

        {/* Título + cliente */}
        <div style={{ background: NAVY, color: "white", borderRadius: "4px", padding: "8px 12px", marginBottom: "10px" }}>
          <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "1px" }}>EXTRATO — {contactName ?? "Sem nome"}</div>
          {contactPhone && <div style={{ fontSize: "9px", opacity: 0.8, marginTop: "2px" }}>{fmtPhone(contactPhone)}</div>}
        </div>

        {/* Totais */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "4px" }}>
          <div style={{ flex: 1, border: "1px solid #f3c6c6", background: "#fdf1f1", borderRadius: "6px", padding: "8px 12px" }}>
            <div style={{ fontSize: "8px", color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.6px" }}>Em aberto</div>
            <div style={{ fontSize: "16px", fontWeight: 900, color: "#b91c1c" }}>{fmtCurrency(totalOwed)}</div>
          </div>
          <div style={{ flex: 1, border: "1px solid #a7e3c5", background: "#f0fbf5", borderRadius: "6px", padding: "8px 12px" }}>
            <div style={{ fontSize: "8px", color: "#047857", textTransform: "uppercase", letterSpacing: "0.6px" }}>Já pago</div>
            <div style={{ fontSize: "16px", fontWeight: 900, color: "#047857" }}>{fmtCurrency(totalPaid)}</div>
          </div>
        </div>

        {/* Em aberto */}
        <SectionTitle>Pedidos em aberto</SectionTitle>
        {pending.length === 0 ? (
          <p style={{ fontSize: "10px", color: "#888", padding: "4px 0" }}>Nenhum pedido em aberto.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: NAVY_LIGHT }}>
                <th style={thL}>Pedido</th>
                <th style={thL}>Vencimento</th>
                <th style={thR}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(o => (
                <tr key={o.id} style={{ borderBottom: "1px solid #e0e4ec" }}>
                  <td style={tdL}>{o.number}</td>
                  <td style={tdL}>{o.dueDate ? fmtDateOnlyBR(o.dueDate) : "—"}</td>
                  <td style={tdR}>{fmtCurrency(o.remaining ?? o.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pago */}
        <SectionTitle>Histórico de pagamentos</SectionTitle>
        {payments.length === 0 ? (
          <p style={{ fontSize: "10px", color: "#888", padding: "4px 0" }}>Nenhum pagamento registrado.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: NAVY_LIGHT }}>
                <th style={thL}>Data</th>
                <th style={thL}>Pedido</th>
                <th style={thL}>Forma</th>
                <th style={thL}>Situação</th>
                <th style={thR}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #e0e4ec" }}>
                  <td style={tdL}>{fmtDateTimeBR(p.createdAt)}</td>
                  <td style={tdL}>{p.orderNumber}</td>
                  <td style={tdL}>{METHOD_LABEL[p.method ?? ""] ?? p.method ?? "—"}</td>
                  <td style={tdL}>{p.totalParcelas > 1 ? `Parcial ${p.parcelaNum}/${p.totalParcelas}` : "Integral"}</td>
                  <td style={tdR}>{fmtCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ borderTop: "1px dashed #ccc", marginTop: "16px", paddingTop: "6px", fontSize: "7px", color: "#aaa" }}>
          SM Confecções · Av. Santa Cruz, 3088 · Franca/SP
        </div>
      </div>
    </PrintShell>
  )
}
