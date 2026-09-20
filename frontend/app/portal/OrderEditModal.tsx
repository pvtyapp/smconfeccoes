"use client"

import { useState } from "react"
import { X, Minus, Trash2, Save, Ban } from "lucide-react"

type Item = { id: number; productName: string; color: string | null; size: string | null; qty: number; unitPrice: number | null }
type Order = { id: number; number: string; items: Item[] }

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function OrderEditModal({
  order, onClose, onSaved, onCanceled,
}: {
  order: Order
  onClose: () => void
  onSaved: () => void
  onCanceled: () => void
}) {
  const [qtys, setQtys] = useState<Record<number, number>>(
    () => Object.fromEntries(order.items.map((i) => [i.id, i.qty]))
  )
  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [error, setError] = useState("")

  function changeQty(itemId: number, delta: number) {
    setQtys((prev) => {
      const original = order.items.find((i) => i.id === itemId)!.qty
      const next = Math.max(0, Math.min(original, (prev[itemId] ?? 0) + delta))
      return { ...prev, [itemId]: next }
    })
  }

  async function handleSave() {
    setError("")
    const changed = order.items
      .filter((i) => qtys[i.id] !== i.qty)
      .map((i) => ({ itemId: i.id, qty: qtys[i.id] }))
    if (changed.length === 0) { onClose(); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: changed }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível salvar"); return }
      onSaved()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelOrder() {
    setCanceling(true)
    setError("")
    try {
      const res = await fetch(`/api/portal/orders/${order.id}/cancel`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível cancelar"); return }
      onCanceled()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setCanceling(false)
    }
  }

  const allRemoved = Object.values(qtys).every((q) => q === 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#0F1E3C]/8">
          <h3 className="text-[#0F1E3C] font-bold text-lg" style={{ fontFamily: "var(--font-playfair)" }}>
            Editar pedido {order.number}
          </h3>
          <button onClick={onClose} aria-label="Fechar" className="text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-xs text-[#0F1E3C]/45">Só é possível diminuir quantidade ou remover item. Pra adicionar algo novo, faça um pedido novo pelo catálogo.</p>

          {order.items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 p-3 rounded-xl border border-[#0F1E3C]/8">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0F1E3C] truncate">{it.productName}</p>
                <p className="text-xs text-[#0F1E3C]/45">
                  {[it.color, it.size].filter(Boolean).join(" · ")} · {fmtR(Number(it.unitPrice ?? 0))}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button" onClick={() => changeQty(it.id, -1)}
                  aria-label={`Diminuir quantidade de ${it.productName}`}
                  className="w-7 h-7 rounded-lg bg-[#F4F6FB] flex items-center justify-center text-[#0F1E3C]/60 hover:text-[#0F1E3C]"
                >
                  <Minus size={13} />
                </button>
                <span className="text-sm font-bold w-6 text-center text-[#0F1E3C]" aria-live="polite">{qtys[it.id]}</span>
                {qtys[it.id] === 0 && <Trash2 size={13} className="text-red-400" />}
              </div>
            </div>
          ))}

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {allRemoved && <p className="text-xs text-amber-600">Removendo todos os itens — use "Cancelar pedido" em vez disso.</p>}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button" onClick={handleSave} disabled={saving || allRemoved}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              <Save size={15} /> {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>

          <div className="border-t border-[#0F1E3C]/8 pt-4">
            {!confirmCancel ? (
              <button
                type="button" onClick={() => setConfirmCancel(true)}
                className="w-full inline-flex items-center justify-center gap-2 text-red-500 hover:text-red-600 text-sm font-semibold py-2"
              >
                <Ban size={15} /> Cancelar pedido inteiro
              </button>
            ) : (
              <div className="bg-red-50 rounded-xl p-4 space-y-3">
                <p className="text-sm text-red-700">Cancelar o pedido {order.number} inteiro? Não dá pra desfazer.</p>
                <div className="flex gap-2">
                  <button
                    type="button" onClick={handleCancelOrder} disabled={canceling}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50"
                  >
                    {canceling ? "Cancelando..." : "Sim, cancelar"}
                  </button>
                  <button
                    type="button" onClick={() => setConfirmCancel(false)}
                    className="flex-1 bg-white border border-[#0F1E3C]/15 text-[#0F1E3C]/60 text-sm font-semibold py-2.5 rounded-lg"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
