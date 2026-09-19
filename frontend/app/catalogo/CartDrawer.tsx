"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { X, Minus, Plus, Trash2, ShoppingBag, CheckCircle2 } from "lucide-react"
import type { CartItem } from "./cart"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CartDrawer({
  items, onClose, onRemove, onChangeQty, onCleared,
}: {
  items: CartItem[]
  onClose: () => void
  onRemove: (variantId: string) => void
  onChangeQty: (variantId: string, qty: number) => void
  onCleared: () => void
}) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "prazo">("pix")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ number: string; outsideBusinessHours: boolean } | null>(null)

  const total = items.reduce((s, i) => s + i.price * i.qty, 0)

  async function handleFinalizar() {
    setError("")
    setSending(true)
    try {
      const res = await fetch("/api/portal/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
          paymentMethod,
        }),
      })
      if (res.status === 401) {
        router.push(`/portal/login?next=${encodeURIComponent("/catalogo")}`)
        return
      }
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível finalizar o pedido"); return }
      setSuccess({ number: data.number, outsideBusinessHours: data.outsideBusinessHours })
      onCleared()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#0F1E3C]/8">
          <h3 className="text-[#0F1E3C] font-bold text-lg" style={{ fontFamily: "var(--font-playfair)" }}>Seu carrinho</h3>
          <button onClick={onClose} aria-label="Fechar carrinho" className="text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><X size={18} /></button>
        </div>

        {success ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center" role="status" aria-live="polite">
            <div className="w-16 h-16 rounded-full bg-[#1B8F63]/10 flex items-center justify-center">
              <CheckCircle2 size={30} className="text-[#1B8F63]" />
            </div>
            <div>
              <p className="text-lg font-black text-[#0F1E3C] mb-1">Pedido enviado com sucesso!</p>
              <p className="text-sm text-[#0F1E3C]/50">Pedido <b className="font-bold text-[#0F1E3C]">{success.number}</b> — te mandamos os detalhes pelo WhatsApp.</p>
              {success.outsideBusinessHours && (
                <p className="text-xs text-amber-600 font-semibold mt-3 bg-amber-50 px-3 py-2 rounded-lg">
                  Estamos fora do horário de atendimento — a separação começa no próximo horário comercial.
                </p>
              )}
            </div>
            <button onClick={onClose} className="mt-2 text-sm font-semibold text-[#4361EE] hover:underline">Continuar navegando</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-[#0F1E3C]/25">
                  <ShoppingBag size={28} />
                  <p className="text-sm">Seu carrinho está vazio.</p>
                </div>
              ) : (
                items.map((i) => (
                  <div key={i.variantId} className="flex items-center gap-3 p-3 rounded-xl border border-[#0F1E3C]/8">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3C] truncate">{i.productName}</p>
                      <p className="text-xs text-[#0F1E3C]/45">
                        {[i.color, i.size].filter(Boolean).join(" · ")} · {fmtR(i.price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 bg-[#F4F6FB] rounded-lg px-1.5 py-1 flex-shrink-0">
                      <button onClick={() => onChangeQty(i.variantId, Math.max(1, i.qty - 1))} aria-label={`Diminuir quantidade de ${i.productName}`} className="text-[#0F1E3C]/50 hover:text-[#0F1E3C]"><Minus size={12} /></button>
                      <span className="text-xs font-bold w-5 text-center text-[#0F1E3C]" aria-live="polite">{i.qty}</span>
                      <button onClick={() => onChangeQty(i.variantId, i.qty + 1)} aria-label={`Aumentar quantidade de ${i.productName}`} className="text-[#0F1E3C]/50 hover:text-[#0F1E3C]"><Plus size={12} /></button>
                    </div>
                    <button onClick={() => onRemove(i.variantId)} aria-label={`Remover ${i.productName} do carrinho`} className="text-red-400 hover:text-red-500 flex-shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="p-6 border-t border-[#0F1E3C]/8 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wide mb-1.5">Pagamento</p>
                  <div className="flex rounded-xl border border-[#0F1E3C]/12 overflow-hidden text-xs font-semibold">
                    <button type="button" onClick={() => setPaymentMethod("pix")}
                      className={`flex-1 py-2.5 transition-colors ${paymentMethod === "pix" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
                      À vista (PIX)
                    </button>
                    <button type="button" onClick={() => setPaymentMethod("prazo")}
                      className={`flex-1 py-2.5 transition-colors ${paymentMethod === "prazo" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
                      Prazo
                    </button>
                  </div>
                  {paymentMethod === "prazo" && (
                    <p className="text-[11px] text-[#0F1E3C]/40 mt-1.5">Prazo combinado com a loja — a data é confirmada na entrega.</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#0F1E3C]/60">Total</span>
                  <span className="text-xl font-black text-[#0F1E3C]">{fmtR(total)}</span>
                </div>

                {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

                <button
                  onClick={handleFinalizar} disabled={sending}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
                >
                  {sending ? "Enviando..." : "Finalizar pedido"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
