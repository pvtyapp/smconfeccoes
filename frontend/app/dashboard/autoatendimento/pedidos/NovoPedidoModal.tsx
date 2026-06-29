"use client"

import { useState, useEffect, useCallback } from "react"
import { todayBR } from "@/lib/tz"
import { X, Search, ChevronRight, ChevronLeft, User, Plus, Minus, Wrench, Package, Check, Calendar, FileText } from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────

type Contact = {
  id: number
  name: string
  phone: string
  jid: string | null
}

type Product = {
  id: number
  name: string
  salePrice: number
  stockEnabled: boolean
  sizes: string[]
  colors: string[]
  status: string
}

type CartItem = {
  productId: number
  productName: string
  color: string | null
  size: string | null
  qty: number
  isService: boolean
  variantNote: string
}

type Step = "cliente" | "itens" | "resumo"

type Picking = {
  color: string | null
  size: string | null
  qty: number
  note: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 2)  return d
  if (d.length <= 7)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "cliente", label: "Cliente" },
    { key: "itens",   label: "Itens" },
    { key: "resumo",  label: "Resumo" },
  ]
  const idx = steps.findIndex(s => s.key === step)
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            i === idx   ? "bg-[#4361EE] text-white" :
            i < idx     ? "bg-emerald-100 text-emerald-700" :
                          "bg-[#0F1E3C]/6 text-[#0F1E3C]/35"
          }`}>
            {i < idx ? <Check size={11} /> : <span>{i + 1}</span>}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-6 h-px mx-0.5 ${i < idx ? "bg-emerald-300" : "bg-[#0F1E3C]/10"}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Modal ────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function NovoPedidoModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("cliente")

  // Data
  const [contacts, setContacts] = useState<Contact[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // Step 1 — Cliente
  const [search, setSearch] = useState("")
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [newMode, setNewMode] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")

  // Step 2 — Itens
  const [cart, setCart] = useState<CartItem[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [picking, setPicking] = useState<Picking>({ color: null, size: null, qty: 1, note: "" })

  // Step 3 — Resumo
  const [deliveryDate, setDeliveryDate] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Load contacts + products once
  useEffect(() => {
    fetch("/api/contacts").then(r => r.json()).then(d => setContacts(Array.isArray(d) ? d : []))
    fetch("/api/products").then(r => r.json()).then(d =>
      setProducts((Array.isArray(d) ? d : []).filter((p: Product) => p.status === "active"))
    )
  }, [])

  // Filtered contacts
  const filteredContacts = contacts.filter(c => {
    const q = search.toLowerCase()
    return !q || c.name?.toLowerCase().includes(q) || c.phone?.includes(q.replace(/\D/g, ""))
  }).slice(0, 8)

  // Filtered products
  const filteredProducts = products.filter(p => {
    const q = productSearch.toLowerCase()
    return !q || p.name.toLowerCase().includes(q)
  })

  // Expand product picker
  function handleExpand(product: Product) {
    if (expandedId === product.id) {
      setExpandedId(null)
    } else {
      setExpandedId(product.id)
      setPicking({ color: null, size: null, qty: 1, note: "" })
    }
  }

  // Add item to cart
  function addToCart(product: Product) {
    const isService = !product.stockEnabled
    if (!isService && (!picking.color || !picking.size)) return

    const key = `${product.id}|${picking.color ?? ""}|${picking.size ?? ""}`
    const existingIdx = cart.findIndex(i =>
      i.productId === product.id &&
      i.color === (isService ? null : picking.color) &&
      i.size  === (isService ? null : picking.size)
    )

    if (existingIdx >= 0) {
      setCart(prev => prev.map((item, idx) =>
        idx === existingIdx ? { ...item, qty: item.qty + picking.qty } : item
      ))
    } else {
      setCart(prev => [...prev, {
        productId:   product.id,
        productName: product.name,
        color:       isService ? null : picking.color,
        size:        isService ? null : picking.size,
        qty:         picking.qty,
        isService,
        variantNote: picking.note,
      }])
    }

    setExpandedId(null)
    setPicking({ color: null, size: null, qty: 1, note: "" })
    void key // suppress unused warning
  }

  function removeFromCart(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx))
  }

  // Validation
  const step1Valid = selectedContact !== null || (newMode && newName.trim().length > 0 && newPhone.replace(/\D/g, "").length >= 10)
  const step2Valid = cart.length > 0

  // Confirm order
  const confirm = useCallback(async () => {
    setSaving(true)
    setSaveError("")
    try {
      let contactId = selectedContact?.id

      if (!contactId && newMode) {
        const r = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), phone: newPhone.replace(/\D/g, "") }),
        })
        if (!r.ok) throw new Error((await r.json()).error ?? "Erro ao criar contato")
        contactId = (await r.json()).id
      }

      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          source: "manual",
          deliveryDate: deliveryDate || null,
          notes: notes.trim() || null,
          items: cart.map(i => ({
            productId:   i.productId,
            productName: i.productName,
            color:       i.color,
            size:        i.size,
            qty:         i.qty,
            isService:   i.isService,
            variantNote: i.variantNote || null,
          })),
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? "Erro ao criar pedido")
      onSuccess()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setSaving(false)
    }
  }, [selectedContact, newMode, newName, newPhone, deliveryDate, notes, cart, onSuccess])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "100%", maxWidth: 640, maxHeight: "90vh" }}
      >

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
              Novo Pedido
            </h2>
            <div className="mt-2">
              <StepBar step={step} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── STEP 1: Cliente ── */}
          {step === "cliente" && (
            <div className="px-6 py-5 space-y-4">

              {/* Search existing contacts */}
              {!newMode && (
                <>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
                    <input
                      autoFocus
                      placeholder="Buscar por nome ou telefone..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); setSelectedContact(null) }}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                    />
                  </div>

                  {/* Contact list */}
                  {search && (
                    <div className="space-y-1">
                      {filteredContacts.length === 0 ? (
                        <div className="text-center py-6 text-sm text-[#0F1E3C]/35">
                          Nenhum contato encontrado
                        </div>
                      ) : (
                        filteredContacts.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setSelectedContact(c)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                              selectedContact?.id === c.id
                                ? "border-[#4361EE]/30 bg-[#4361EE]/6"
                                : "border-[#0F1E3C]/8 hover:bg-[#F9FAFB]"
                            }`}
                          >
                            <div className="w-9 h-9 rounded-full bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
                              <User size={15} className="text-[#4361EE]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[#0F1E3C] truncate">{c.name ?? "—"}</p>
                              <p className="text-xs text-[#0F1E3C]/40">{fmtPhone(c.phone ?? "")}</p>
                            </div>
                            {selectedContact?.id === c.id && (
                              <Check size={14} className="text-[#4361EE] flex-shrink-0" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* Selected contact preview */}
                  {selectedContact && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <Check size={15} className="text-emerald-600" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-700">{selectedContact.name}</p>
                        <p className="text-xs text-emerald-600/70">{fmtPhone(selectedContact.phone)}</p>
                      </div>
                      <button
                        onClick={() => { setSelectedContact(null); setSearch("") }}
                        className="ml-auto text-[10px] text-emerald-600 underline"
                      >
                        trocar
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-[#0F1E3C]/8" />
                    <span className="text-[10px] text-[#0F1E3C]/30 uppercase tracking-wider">ou</span>
                    <div className="flex-1 h-px bg-[#0F1E3C]/8" />
                  </div>

                  <button
                    onClick={() => { setNewMode(true); setSearch(""); setSelectedContact(null) }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-[#4361EE]/30 text-sm text-[#4361EE] font-medium hover:bg-[#4361EE]/4 transition-colors"
                  >
                    <Plus size={14} />
                    Criar novo cliente
                  </button>
                </>
              )}

              {/* New contact form */}
              {newMode && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      onClick={() => setNewMode(false)}
                      className="text-xs text-[#4361EE] hover:underline flex items-center gap-1"
                    >
                      <ChevronLeft size={12} />
                      Buscar existente
                    </button>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Nome</label>
                    <input
                      autoFocus
                      placeholder="Nome do cliente"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Telefone</label>
                    <input
                      placeholder="(00) 00000-0000"
                      value={newPhone}
                      onChange={e => setNewPhone(fmtPhone(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Itens ── */}
          {step === "itens" && (
            <div className="px-6 py-5 space-y-3">

              {/* Product search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
                <input
                  autoFocus
                  placeholder="Buscar produto..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
              </div>

              {/* Product list */}
              <div className="space-y-1.5">
                {filteredProducts.map(product => {
                  const isExpanded = expandedId === product.id
                  const isService = !product.stockEnabled
                  const canAdd = isService
                    ? picking.qty > 0
                    : picking.color !== null && picking.size !== null && picking.qty > 0

                  return (
                    <div key={product.id} className={`rounded-xl border overflow-hidden transition-all ${
                      isExpanded ? "border-[#4361EE]/25" : "border-[#0F1E3C]/8"
                    }`}>
                      {/* Product row */}
                      <button
                        onClick={() => handleExpand(product)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F9FAFB] transition-colors text-left"
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isService ? "bg-amber-50" : "bg-[#4361EE]/8"
                        }`}>
                          {isService
                            ? <Wrench size={14} className="text-amber-600" />
                            : <Package size={14} className="text-[#4361EE]" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#0F1E3C] truncate">{product.name}</p>
                            {isService && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">
                                SERVIÇO
                              </span>
                            )}
                          </div>
                          {product.salePrice > 0 && (
                            <p className="text-xs text-[#0F1E3C]/40">
                              R$ {product.salePrice.toFixed(2).replace(".", ",")}
                            </p>
                          )}
                        </div>
                        <Plus
                          size={15}
                          className={`flex-shrink-0 transition-transform ${isExpanded ? "rotate-45 text-[#4361EE]" : "text-[#0F1E3C]/30"}`}
                        />
                      </button>

                      {/* Expanded picker */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 bg-[#F9FAFB] border-t border-[#0F1E3C]/6 space-y-3">

                          {/* Physical: color picker */}
                          {!isService && product.colors.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Cor</p>
                              <div className="flex flex-wrap gap-1.5">
                                {product.colors.map(c => (
                                  <button
                                    key={c}
                                    onClick={() => setPicking(prev => ({ ...prev, color: c, size: null }))}
                                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                      picking.color === c
                                        ? "bg-[#4361EE] text-white border-[#4361EE]"
                                        : "bg-white text-[#0F1E3C]/70 border-[#0F1E3C]/12 hover:border-[#4361EE]/30"
                                    }`}
                                  >
                                    {c}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Physical: size picker */}
                          {!isService && product.sizes.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Tamanho</p>
                              <div className="flex flex-wrap gap-1.5">
                                {product.sizes.map(s => (
                                  <button
                                    key={s}
                                    onClick={() => setPicking(prev => ({ ...prev, size: s }))}
                                    className={`w-10 h-8 rounded-lg text-xs font-semibold border transition-all ${
                                      picking.size === s
                                        ? "bg-[#4361EE] text-white border-[#4361EE]"
                                        : "bg-white text-[#0F1E3C]/70 border-[#0F1E3C]/12 hover:border-[#4361EE]/30"
                                    }`}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Service: note */}
                          {isService && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">
                                Descrição do serviço (opcional)
                              </p>
                              <input
                                placeholder="Ex: camiseta bordada manga longa"
                                value={picking.note}
                                onChange={e => setPicking(prev => ({ ...prev, note: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/25 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 bg-white"
                              />
                            </div>
                          )}

                          {/* Qty + Add button */}
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPicking(prev => ({ ...prev, qty: Math.max(1, prev.qty - 1) }))}
                                className="w-8 h-8 rounded-xl border border-[#0F1E3C]/12 hover:bg-white text-[#0F1E3C]/50 font-bold flex items-center justify-center transition-colors"
                              >
                                <Minus size={12} />
                              </button>
                              <span className="w-10 text-center text-sm font-black text-[#0F1E3C]">{picking.qty}</span>
                              <button
                                onClick={() => setPicking(prev => ({ ...prev, qty: prev.qty + 1 }))}
                                className="w-8 h-8 rounded-xl border border-[#0F1E3C]/12 hover:bg-white text-[#0F1E3C]/50 font-bold flex items-center justify-center transition-colors"
                              >
                                <Plus size={12} />
                              </button>
                              <span className="text-xs text-[#0F1E3C]/40">pç</span>
                            </div>
                            <button
                              onClick={() => addToCart(product)}
                              disabled={!canAdd}
                              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                                canAdd
                                  ? "bg-[#4361EE] text-white hover:bg-[#3451D1]"
                                  : "bg-[#0F1E3C]/6 text-[#0F1E3C]/30 cursor-not-allowed"
                              }`}
                            >
                              Adicionar ao pedido
                            </button>
                          </div>
                          {!isService && (!picking.color || !picking.size) && (
                            <p className="text-[10px] text-[#0F1E3C]/30 -mt-1">Selecione cor e tamanho para adicionar</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {filteredProducts.length === 0 && (
                  <div className="text-center py-8 text-sm text-[#0F1E3C]/30">
                    Nenhum produto ativo encontrado
                  </div>
                )}
              </div>

              {/* Cart preview */}
              {cart.length > 0 && (
                <div className="mt-4 bg-[#F9FAFB] rounded-xl border border-[#0F1E3C]/8 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 px-4 pt-3 pb-2">
                    Carrinho — {cart.length} {cart.length === 1 ? "item" : "itens"}
                  </p>
                  {cart.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-4 py-2.5 border-t border-[#0F1E3C]/6 hover:bg-white transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.isService
                          ? <Wrench size={12} className="text-amber-500 flex-shrink-0" />
                          : <Package size={12} className="text-[#4361EE] flex-shrink-0" />
                        }
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#0F1E3C] truncate">{item.productName}</p>
                          {(item.color || item.size) && (
                            <p className="text-[10px] text-[#0F1E3C]/40">{[item.color, item.size].filter(Boolean).join(" · ")}</p>
                          )}
                          {item.variantNote && (
                            <p className="text-[10px] text-[#0F1E3C]/40 truncate">{item.variantNote}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-black text-[#0F1E3C]">{item.qty} pç</span>
                        <button
                          onClick={() => removeFromCart(idx)}
                          className="text-[#0F1E3C]/20 hover:text-red-400 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Resumo ── */}
          {step === "resumo" && (
            <div className="px-6 py-5 space-y-4">

              {/* Contact card */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/8">
                <div className="w-9 h-9 rounded-full bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
                  <User size={15} className="text-[#4361EE]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">
                    {selectedContact?.name ?? newName}
                  </p>
                  <p className="text-xs text-[#0F1E3C]/40">
                    {fmtPhone(selectedContact?.phone ?? newPhone)}
                    {newMode && <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold uppercase">Novo cliente</span>}
                  </p>
                </div>
              </div>

              {/* Items list */}
              <div className="rounded-xl border border-[#0F1E3C]/8 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 px-4 pt-3 pb-2">
                  {cart.length} {cart.length === 1 ? "item" : "itens"} no pedido
                </p>
                {cart.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-4 py-2.5 border-t border-[#0F1E3C]/6"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {item.isService
                        ? <Wrench size={12} className="text-amber-500 flex-shrink-0" />
                        : <Package size={12} className="text-[#4361EE] flex-shrink-0" />
                      }
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0F1E3C] truncate">{item.productName}</p>
                        {(item.color || item.size) && (
                          <p className="text-[10px] text-[#0F1E3C]/40">{[item.color, item.size].filter(Boolean).join(" · ")}</p>
                        )}
                        {item.variantNote && (
                          <p className="text-[10px] text-[#0F1E3C]/40 italic truncate">{item.variantNote}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-black text-[#0F1E3C]">{item.qty} pç</span>
                  </div>
                ))}
              </div>

              {/* Delivery date */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">
                  <Calendar size={11} />
                  Previsão de entrega (opcional)
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                  min={todayBR()}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">
                  <FileText size={11} />
                  Observações (opcional)
                </label>
                <textarea
                  placeholder="Instruções especiais, referências, etc."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 resize-none"
                />
              </div>

              {/* Error */}
              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 px-4 py-2.5 rounded-xl border border-red-200">
                  {saveError}
                </p>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0 bg-[#F9FAFB]">

          {/* Back */}
          <button
            onClick={() => {
              if (step === "itens")   setStep("cliente")
              if (step === "resumo")  setStep("itens")
              if (step === "cliente") onClose()
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors"
          >
            <ChevronLeft size={14} />
            {step === "cliente" ? "Cancelar" : "Voltar"}
          </button>

          {/* Forward / Confirm */}
          {step === "resumo" ? (
            <button
              onClick={confirm}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-[#4361EE] text-white hover:bg-[#3451D1] disabled:opacity-60 transition-colors"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {saving ? "Salvando..." : "Confirmar Pedido"}
            </button>
          ) : (
            <button
              onClick={() => {
                if (step === "cliente" && step1Valid) setStep("itens")
                if (step === "itens"   && step2Valid) setStep("resumo")
              }}
              disabled={step === "cliente" ? !step1Valid : !step2Valid}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#4361EE] text-white hover:bg-[#3451D1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continuar
              <ChevronRight size={14} />
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
