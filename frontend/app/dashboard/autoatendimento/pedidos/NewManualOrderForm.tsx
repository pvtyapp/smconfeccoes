"use client"

import { useState, useEffect, useMemo } from "react"
import { X, Loader2, Trash2, Search } from "lucide-react"
import { todayBR } from "@/lib/tz"
import { sizeCompare } from "@/lib/sizeOrder"

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

  // Bloco de produto → produto fica aberto com todas as cores/tamanhos juntos
  // (toca no tamanho e já adiciona, sem resetar) — só volta pros blocos quando
  // o usuário quiser trocar de produto de propósito.
  const [openProduct, setOpenProduct] = useState("")
  const [search,      setSearch]      = useState("")

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState("")

  // Produto ou DTF — mesmo modal, abas separadas (DTF entra sempre como triagem
  // virgem, igual ao pedido criado automaticamente quando o cliente manda arquivo
  // solto no chat; metros/largura/arte são preenchidos depois, no card do pedido)
  const [tab, setTab] = useState<"produto" | "dtf">("produto")

  useEffect(() => {
    fetch("/api/stock/balance")
      .then(r => r.ok ? r.json() : [])
      .then((raw: Variant[]) => setVariants(raw.map(v => ({ ...v, salePrice: Number(v.salePrice) || 0 }))))
      .finally(() => setLoading(false))
  }, [])

  // Blocos de produto (nome + preço + cores) pra grade de seleção
  const productBlocks = useMemo(() => {
    const map = new Map<string, Variant[]>()
    for (const v of variants) {
      if (!map.has(v.productName)) map.set(v.productName, [])
      map.get(v.productName)!.push(v)
    }
    return [...map.entries()]
      .map(([name, vs]) => ({
        name,
        price: vs[0]?.salePrice ?? 0,
        colors: [...new Set(vs.map(v => v.color))].filter(Boolean),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [variants])

  const filteredBlocks = useMemo(() => {
    const q = search.toLowerCase().trim()
    return q ? productBlocks.filter(p => p.name.toLowerCase().includes(q)) : productBlocks
  }, [productBlocks, search])

  // Cores + tamanhos do produto aberto, todos juntos (nada reseta ao adicionar)
  const openColorGroups = useMemo(() => {
    if (!openProduct) return []
    const map = new Map<string, Variant[]>()
    for (const v of variants) {
      if (v.productName !== openProduct) continue
      if (!map.has(v.color)) map.set(v.color, [])
      map.get(v.color)!.push(v)
    }
    const groups = [...map.entries()]
    groups.forEach(([, vs]) => vs.sort((a, b) => sizeCompare(a.size, b.size)))
    return groups
  }, [variants, openProduct])

  function qtyFor(variantId: string): number {
    return items.find(i => i.variantId === variantId)?.qty ?? 0
  }

  function pickSize(color: string, size: string) {
    const variant = variants.find(v => v.productName === openProduct && v.color === color && v.size === size)
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
    // Produto continua aberto — dá pra lançar o próximo tamanho/cor direto
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

  async function handleSubmitDtf() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/dtf/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          data: todayBR(),
          status: "triagem",
          source: "manual",
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? "Erro ao criar pedido DTF")
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

          <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
            <button type="button" onClick={() => setTab("produto")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === "produto" ? "bg-[#4361EE]/12 text-[#3451D4]" : "text-[#0F1E3C]/35 hover:bg-[#0F1E3C]/4"
              }`}>
              Produto
            </button>
            <button type="button" onClick={() => setTab("dtf")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === "dtf" ? "bg-[#7C3AED]/12 text-[#6B2FD1]" : "text-[#0F1E3C]/35 hover:bg-[#0F1E3C]/4"
              }`}>
              DTF
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {tab === "dtf" ? (
              <>
                <p className="text-xs text-[#0F1E3C]/50 leading-relaxed">
                  Cria um pedido DTF novo em <span className="font-bold text-[#0F1E3C]">triagem</span>, sem metros,
                  largura ou arte ainda — igual ao pedido virgem criado quando o cliente manda um arquivo solto no
                  chat. Metros, largura e a arte são preenchidos depois, direto no card do pedido.
                </p>
                {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              </>
            ) : loading ? (
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

                {/* Blocos de produto */}
                <div className={items.length > 0 ? "pt-3 border-t border-dashed border-[#0F1E3C]/12 space-y-2.5" : "space-y-2.5"}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">
                    {items.length > 0 ? "Adicionar próximo item" : "Adicionar item"}
                  </p>

                  {!openProduct ? (
                    <>
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none"/>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..."
                          className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {filteredBlocks.map(p => (
                          <button key={p.name} type="button" onClick={() => setOpenProduct(p.name)}
                            className="flex flex-col gap-1 text-left px-3 py-2.5 rounded-xl border border-[#0F1E3C]/12 bg-white hover:border-[#4361EE]/40 hover:bg-[#4361EE]/4 transition-colors">
                            <div className="flex items-center gap-1">
                              {p.colors.slice(0, 5).map(c => (
                                <span key={c} className="w-2.5 h-2.5 rounded-[3px] bg-[#0F1E3C]/15 shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]"/>
                              ))}
                              {p.colors.length > 5 && <span className="text-[9px] font-bold text-[#0F1E3C]/35">+{p.colors.length - 5}</span>}
                            </div>
                            <span className="text-xs font-bold text-[#0F1E3C] leading-tight">{p.name}</span>
                            <span className="text-xs font-black text-[#4361EE]">R$ {p.price.toFixed(2).replace(".", ",")}</span>
                          </button>
                        ))}
                        {filteredBlocks.length === 0 && (
                          <p className="col-span-2 text-center text-xs text-[#0F1E3C]/30 py-4">Nada encontrado</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 pb-1">
                        <span className="text-xs font-bold text-[#0F1E3C]">{openProduct}</span>
                        <button type="button" onClick={() => setOpenProduct("")}
                          className="ml-auto text-[11px] font-bold text-[#0F1E3C]/40 hover:text-[#4361EE] hover:bg-[#0F1E3C]/4 px-2 py-1 rounded-lg transition-colors">
                          ↩ trocar produto
                        </button>
                      </div>
                      {openColorGroups.map(([c, vs]) => (
                        <div key={c} className="space-y-1.5">
                          {c && <p className="text-[10px] font-bold text-[#0F1E3C]/40">{c}</p>}
                          <div className="flex flex-wrap gap-1.5">
                            {vs.map(v => {
                              const q = qtyFor(v.variantId)
                              return (
                                <button key={v.variantId} type="button" onClick={() => pickSize(v.color, v.size)}
                                  className={`relative px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                                    q > 0
                                      ? "bg-emerald-500 text-white border-emerald-500"
                                      : "bg-white border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:bg-emerald-500 hover:text-white hover:border-emerald-500"
                                  }`}>
                                  {q > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#0F1E3C] text-white rounded-full text-[8px] font-black flex items-center justify-center leading-none">
                                      {q}
                                    </span>
                                  )}
                                  {v.size || "U"}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </>
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
            <button onClick={tab === "dtf" ? handleSubmitDtf : handleSubmit}
              disabled={saving || (tab === "produto" && items.length === 0)}
              className={`flex-1 flex items-center justify-center gap-2 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 transition-colors ${
                tab === "dtf" ? "bg-[#7C3AED] hover:bg-[#6B2FD1]" : "bg-[#4361EE] hover:bg-[#3451D4]"
              }`}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {tab === "dtf" ? "Criar Pedido DTF" : "Criar Pedido"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
