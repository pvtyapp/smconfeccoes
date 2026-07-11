"use client"

import { useState, useEffect, useMemo } from "react"
import { X, Loader2, Trash2 } from "lucide-react"

type Variant = {
  variantId: string
  productName: string
  color: string
  size: string
  salePrice: number
  currentStock: number
}

type Item = {
  variantId: string
  productName: string
  color: string
  size: string
  qty: number
  salePrice: number
}

export default function NewManualOrderForm({ contactId, onClose, onCreated }: {
  contactId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [variants, setVariants] = useState<Variant[]>([])
  const [loading,  setLoading]  = useState(true)
  const [items,    setItems]    = useState<Item[]>([])

  // Picker encadeado: produto → cor → tamanho (toca no tamanho e já adiciona,
  // volta pro passo 1 pronto pro próximo item — sem fechar nada no meio)
  const [product, setProduct] = useState("")
  const [color,   setColor]   = useState("")

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState("")

  useEffect(() => {
    fetch("/api/stock/balance")
      .then(r => r.ok ? r.json() : [])
      .then((raw: Variant[]) => setVariants(raw.map(v => ({ ...v, salePrice: Number(v.salePrice) || 0 }))))
      .finally(() => setLoading(false))
  }, [])

  const productNames = useMemo(
    () => [...new Set(variants.map(v => v.productName))].sort(),
    [variants]
  )
  const colors = useMemo(
    () => [...new Set(variants.filter(v => v.productName === product).map(v => v.color))].sort(),
    [variants, product]
  )
  const sizes = useMemo(
    () => [...new Set(variants.filter(v => v.productName === product && v.color === color).map(v => v.size))].sort(),
    [variants, product, color]
  )

  function pickProduct(p: string) {
    setProduct(p)
    setColor("")
  }

  function pickColor(c: string) {
    setColor(c)
  }

  function pickSize(s: string) {
    const variant = variants.find(v => v.productName === product && v.color === color && v.size === s)
    if (!variant) return
    setItems(prev => {
      const idx = prev.findIndex(i => i.variantId === variant.variantId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, {
        variantId: variant.variantId, productName: variant.productName,
        color: variant.color, size: variant.size, qty: 1, salePrice: variant.salePrice,
      }]
    })
    // Volta pro passo 1, pronto pra encadear o próximo item sem fechar o picker
    setProduct("")
    setColor("")
  }

  function setQty(idx: number, val: number) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: Math.max(1, val) } : it))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const total = items.reduce((s, i) => s + i.qty * i.salePrice, 0)

  async function handleSubmit() {
    if (items.length === 0) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/orders/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          items: items.map(i => ({ variantId: i.variantId, qty: i.qty })),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? "Erro ao criar pedido")
        return
      }
      onCreated()
      onClose()
    } catch {
      setError("Erro de conexão")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Novo Pedido Manual</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin text-[#0F1E3C]/30" />
              </div>
            ) : (
              <>
                {/* Items list */}
                {items.length > 0 && (
                  <div className="space-y-1.5">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F4F6FB]">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#0F1E3C] truncate">{it.productName}</p>
                          <p className="text-[10px] text-[#0F1E3C]/40">{[it.color, it.size].filter(Boolean).join(" · ")}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => setQty(idx, it.qty - 1)}
                            className="w-6 h-6 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-xs font-bold flex items-center justify-center">−</button>
                          <span className="w-6 text-center text-xs font-black text-[#0F1E3C]">{it.qty}</span>
                          <button onClick={() => setQty(idx, it.qty + 1)}
                            className="w-6 h-6 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-xs font-bold flex items-center justify-center">+</button>
                        </div>
                        <span className="text-xs font-bold text-[#0F1E3C] flex-shrink-0 w-16 text-right">R$ {(it.qty * it.salePrice).toFixed(2).replace(".", ",")}</span>
                        <button onClick={() => removeItem(idx)} className="text-[#0F1E3C]/25 hover:text-red-400 flex-shrink-0"><Trash2 size={13} /></button>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 pt-1">
                      <span className="text-xs text-[#0F1E3C]/40">Total</span>
                      <span className="text-sm font-black text-[#0F1E3C]">R$ {total.toFixed(2).replace(".", ",")}</span>
                    </div>
                  </div>
                )}

                {/* Picker encadeado */}
                <div className={items.length > 0 ? "pt-3 border-t border-dashed border-[#0F1E3C]/12 space-y-2.5" : "space-y-2.5"}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">
                    {items.length > 0 ? "Adicionar próximo item" : "Adicionar item"}
                  </p>

                  <select value={product} onChange={e => pickProduct(e.target.value)}
                    className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] bg-white">
                    <option value="">Selecionar produto...</option>
                    {productNames.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>

                  {product && (
                    <div className="flex flex-wrap gap-1.5">
                      {colors.map(c => (
                        <button key={c} type="button" onClick={() => pickColor(c)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                            color === c
                              ? "bg-[#4361EE] text-white border-[#4361EE]"
                              : "bg-white border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:border-[#4361EE]/40"
                          }`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  )}

                  {product && color && (
                    <div className="flex flex-wrap gap-1.5">
                      {sizes.map(s => (
                        <button key={s} type="button" onClick={() => pickSize(s)}
                          className="px-3 py-1.5 rounded-xl border text-xs font-semibold bg-white border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-colors">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              </>
            )}
          </div>

          <div className="px-5 py-4 border-t border-[#0F1E3C]/8 flex gap-2 flex-shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={items.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 transition-colors">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Criar Pedido
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
