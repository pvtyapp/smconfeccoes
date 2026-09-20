"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Minus, Plus, Trash2, ShoppingBag, CheckCircle2, AlertTriangle } from "lucide-react"
import type { CartItem } from "./cart"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CartPanel({
  items, onRemove, onChangeQty, onCleared,
}: {
  items: CartItem[]
  onRemove: (variantId: string) => void
  onChangeQty: (variantId: string, qty: number) => void
  onCleared: () => void
}) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "prazo">("pix")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [success, setSuccess] = useState<{ number: string; outsideBusinessHours: boolean } | null>(null)

  const total = items.reduce((s, i) => s + i.price * i.qty, 0)

  async function handleFinalizar() {
    setError("")
    setMissingFields([])
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
      if (!res.ok) {
        setError(data.error ?? "Não foi possível finalizar o pedido")
        setMissingFields(data.missing ?? [])
        return
      }
      setSuccess({ number: data.number, outsideBusinessHours: data.outsideBusinessHours })
      onCleared()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl md:sticky md:top-5 flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#0F1E3C]/8">
        <h3 className="text-[#0F1E3C] font-bold text-base" style={{ fontFamily: "var(--font-playfair)" }}>Seu carrinho</h3>
      </div>

      {success ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center" role="status" aria-live="polite">
          <div className="w-14 h-14 rounded-full bg-[#1B8F63]/10 flex items-center justify-center">
            <CheckCircle2 size={26} className="text-[#1B8F63]" />
          </div>
          <div>
            <p className="text-base font-black text-[#0F1E3C] mb-1">Pedido enviado com sucesso!</p>
            <p className="text-xs text-[#0F1E3C]/50">Pedido <b className="font-bold text-[#0F1E3C]">{success.number}</b> — te mandamos os detalhes pelo WhatsApp.</p>
            {success.outsideBusinessHours && (
              <p className="text-xs text-amber-600 font-semibold mt-3 bg-amber-50 px-3 py-2 rounded-lg">
                Estamos fora do horário de atendimento — a separação começa no próximo horário comercial.
              </p>
            )}
          </div>
          <button onClick={() => setSuccess(null)} className="mt-1 text-sm font-semibold text-[#4361EE] hover:underline">Continuar comprando</button>
        </div>
      ) : (
        <>
          <div className="p-4 space-y-2.5 max-h-[46vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[#0F1E3C]/25">
                <ShoppingBag size={24} />
                <p className="text-sm">Seu carrinho está vazio.</p>
              </div>
            ) : (
              items.map((i) => (
                <div key={i.variantId} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[#0F1E3C]/8">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0F1E3C] truncate">{i.productName}</p>
                    <p className="text-[11px] text-[#0F1E3C]/45">
                      {[i.color, i.size].filter(Boolean).join(" · ")} · {fmtR(i.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-[#F4F6FB] rounded-lg px-1 py-0.5 flex-shrink-0">
                    <button onClick={() => onChangeQty(i.variantId, Math.max(1, i.qty - 1))} aria-label={`Diminuir quantidade de ${i.productName}`} className="text-[#0F1E3C]/50 hover:text-[#0F1E3C]"><Minus size={11} /></button>
                    <span className="text-xs font-bold w-4 text-center text-[#0F1E3C]" aria-live="polite">{i.qty}</span>
                    <button onClick={() => onChangeQty(i.variantId, i.qty + 1)} aria-label={`Aumentar quantidade de ${i.productName}`} className="text-[#0F1E3C]/50 hover:text-[#0F1E3C]"><Plus size={11} /></button>
                  </div>
                  <button onClick={() => onRemove(i.variantId)} aria-label={`Remover ${i.productName} do carrinho`} className="text-red-400 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
                </div>
              ))
            )}
          </div>

          {items.length > 0 && (
            <div className="p-4 border-t border-[#0F1E3C]/8 space-y-3.5">
              <div>
                <p className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wide mb-1.5">Pagamento</p>
                <div className="flex rounded-xl border border-[#0F1E3C]/12 overflow-hidden text-xs font-semibold">
                  <button type="button" onClick={() => setPaymentMethod("pix")}
                    className={`flex-1 py-2 transition-colors ${paymentMethod === "pix" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
                    À vista
                  </button>
                  <button type="button" onClick={() => setPaymentMethod("prazo")}
                    className={`flex-1 py-2 transition-colors ${paymentMethod === "prazo" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
                    Prazo
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-[#0F1E3C]/60">Total</span>
                <span className="text-lg font-black text-[#0F1E3C]">{fmtR(total)}</span>
              </div>

              {error && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">{error}</p>
                  </div>
                  {missingFields.length > 0 && (
                    <Link href="/portal" className="inline-block mt-2 text-xs font-bold text-[#4361EE] hover:underline">
                      Completar cadastro em Meus Dados →
                    </Link>
                  )}
                </div>
              )}

              <button
                onClick={handleFinalizar} disabled={sending}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-50"
              >
                {sending ? "Enviando..." : "Finalizar pedido"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
