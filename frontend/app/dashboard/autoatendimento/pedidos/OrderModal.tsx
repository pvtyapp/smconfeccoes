"use client"

import { useState, useEffect } from "react"
import { X, Printer, Check, Trash2, Plus, ChevronRight, Loader2, Package, Clock, AlertTriangle, RotateCcw } from "lucide-react"
import type { Order, OrderItem } from "./page"
import { subDaysBR } from "@/lib/tz"
import PrintSheet from "./PrintSheet"
import Toggle from "@/components/Toggle"

type Props = {
  order: Order
  onClose: () => void
  onRefresh: () => void
}

const STATUS_LABEL: Record<string, string> = {
  triagem:      "Triagem",
  confirmando:  "Aguard. Confirmação",
  em_separacao: "Em Separação",
  pronto:       "Pronto p/ Retirada",
  pago:         "Pago",
  concluido:    "Retirado",
  cancelado:    "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:      "bg-amber-100 text-amber-700",
  confirmando:  "bg-purple-100 text-purple-700",
  em_separacao: "bg-blue-100 text-blue-700",
  pronto:       "bg-orange-100 text-orange-700",
  pago:         "bg-green-100 text-green-700",
  concluido:    "bg-[#0F1E3C]/8 text-[#0F1E3C]/50",
  cancelado:    "bg-red-100 text-red-600",
}

type IndexedItem = OrderItem & { _idx: number }
type Group = { productName: string; items: IndexedItem[] }

function groupItems(items: OrderItem[]): Group[] {
  const map: Record<string, Group> = {}
  items.forEach((item, idx) => {
    const key = item.productName.trim().toLowerCase()
    if (!map[key]) map[key] = { productName: item.productName, items: [] }
    map[key].items.push({ ...item, _idx: idx })
  })
  return Object.values(map)
}

type ProductOption = {
  id: string; name: string; salePrice: number | null
  sizes: string[]; colors: string[]; status: string; chatbotEnabled: boolean
}

type VariantOption = { id: string; color: string; size: string; salePrice: number | null }

export default function OrderModal({ order, onClose, onRefresh }: Props) {
  const [items,         setItems]         = useState<OrderItem[]>(order.items.map(i => ({ ...i })))
  const [saving,        setSaving]        = useState(false)
  const [printFormat,   setPrintFormat]   = useState<"a4" | "thermal">("a4")
  const [showPrint,     setShowPrint]     = useState(false)
  const [hasPrinted,    setHasPrinted]    = useState(false)
  const [printedHash,   setPrintedHash]   = useState("")

  // Adicionar item inline (produto → cor → tamanho, mapeado ao estoque; qtd ajusta depois pelo stepper)
  const [addingItem,   setAddingItem]     = useState(false)
  const [products,      setProducts]      = useState<ProductOption[]>([])
  const [addProd,       setAddProd]       = useState<ProductOption | null>(null)
  const [addColor,      setAddColor]      = useState("")
  const [addSize,       setAddSize]       = useState("")
  const [addVariants,   setAddVariants]   = useState<VariantOption[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`print_${order.id}`)
      if (saved) {
        const { hash } = JSON.parse(saved)
        setPrintedHash(hash)
        setHasPrinted(true)
      }
    } catch { /* ignora */ }
  }, [order.id])
  const [showCancel,    setShowCancel]    = useState(false)
  const [notifyClient,  setNotifyClient]  = useState(true)
  const [cancelMsg,     setCancelMsg]     = useState(`Seu pedido ${order.number} foi cancelado. Qualquer dúvida é só chamar.`)
  const [isPaid,        setIsPaid]        = useState(true)
  const [dueDate,       setDueDate]       = useState("")
  const [error,         setError]         = useState("")

  function itemsHash(list: OrderItem[]) {
    return list.map(i => `${i.productName}|${i.color}|${i.size}|${i.qty}`).join(",")
  }
  const currentHash  = itemsHash(items)
  const needsReprint = hasPrinted && currentHash !== printedHash

  function handlePrint() {
    setPrintedHash(currentHash)
    setHasPrinted(true)
    try { localStorage.setItem(`print_${order.id}`, JSON.stringify({ hash: currentHash })) } catch { /* ignora */ }
    setShowPrint(true)
    setTimeout(() => window.print(), 300)
  }

  const isTriagem    = order.status === "triagem"
  const isConfirm    = order.status === "confirmando"
  const isSeparacao  = order.status === "em_separacao"
  const isPronte     = order.status === "pronto"
  const isPago       = order.status === "pago"
  const isDone       = order.status === "concluido" || order.status === "cancelado"

  const groups   = groupItems(items)
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)

  function setQty(idx: number, val: number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(1, val) } : item))
  }

  function setQtyConfirmed(idx: number, val: number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, qtyConfirmed: Math.max(0, val) } : item))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function startAddItem() {
    if (!products.length) {
      const res = await fetch("/api/products")
      if (res.ok) {
        const all: ProductOption[] = await res.json()
        setProducts(all.filter(p => p.status === "active"))
      }
    }
    setAddProd(null); setAddColor(""); setAddSize(""); setAddVariants([])
    setAddingItem(true)
  }

  function cancelAddItem() {
    setAddingItem(false); setAddProd(null); setAddColor(""); setAddSize(""); setAddVariants([])
  }

  function finalizeNewItem(prod: ProductOption, color: string, size: string, variants: VariantOption[]) {
    const variant = variants.find(v => v.color === color && v.size === size)
    setItems(prev => [...prev, {
      id: 0, productId: prod.id, productName: prod.name,
      color, size, qty: 1,
      qtyConfirmed: null, isService: false, variantNote: null,
      variantId: variant?.id ?? null,
      unitPrice: variant?.salePrice ?? prod.salePrice ?? null,
    }])
    cancelAddItem()
  }

  async function selectAddProduct(p: ProductOption) {
    setAddProd(p); setAddColor(""); setAddSize("")
    const res = await fetch(`/api/variants?productId=${p.id}`)
    const variants: VariantOption[] = res.ok ? await res.json() : []
    setAddVariants(variants)
    if (p.colors.length === 0 && p.sizes.length === 0) finalizeNewItem(p, "", "", variants)
  }

  function chooseAddColor(c: string) {
    setAddColor(c)
    if (!addProd) return
    if (addProd.sizes.length === 0 || addSize) finalizeNewItem(addProd, c, addSize, addVariants)
  }

  function chooseAddSize(s: string) {
    setAddSize(s)
    if (!addProd) return
    if (addProd.colors.length === 0 || addColor) finalizeNewItem(addProd, addColor, s, addVariants)
  }

  async function saveItems() {
    await fetch(`/api/orders/${order.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
  }

  async function postStatus(status: string, extra: Record<string, unknown> = {}) {
    return fetch(`/api/orders/${order.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    })
  }

  async function handleEnviarConfirmar() {
    setSaving(true)
    try {
      await saveItems()
      await postStatus("confirmando")
      onRefresh()
    } finally { setSaving(false) }
  }

  async function handleAvancarManual() {
    setSaving(true)
    try {
      await saveItems()
      await postStatus("em_separacao")
      onRefresh()
    } finally { setSaving(false) }
  }

  async function handleMarcarPronte() {
    setSaving(true)
    try {
      await saveItems()
      await postStatus("pronto")
      onRefresh()
    } finally { setSaving(false) }
  }

  async function handleMarcarPago() {
    setSaving(true)
    try {
      await postStatus("pago")
      onRefresh()
    } finally { setSaving(false) }
  }

  async function handleConcluirPrazo() {
    if (!dueDate) { setError("Informe a data de vencimento pra concluir a prazo."); return }
    setSaving(true)
    setError("")
    try {
      await postStatus("concluido", { dueDate })
      onRefresh()
      onClose()
    } finally { setSaving(false) }
  }

  async function handleConfirmarRetirada() {
    setSaving(true)
    try {
      await postStatus("concluido")
      onRefresh()
      onClose()
    } finally { setSaving(false) }
  }

  async function confirmCancel() {
    setSaving(true)
    try {
      await postStatus("cancelado", { note: "Cancelado pelo operador", notifyClient, cancelMessage: notifyClient ? cancelMsg : undefined })
      setShowCancel(false)
      onRefresh()
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-base font-black text-[#0F1E3C]">{order.number}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[order.status] ?? ""}`}>
                {STATUS_LABEL[order.status] ?? order.status}
              </span>
            </div>
            <p className="text-xs text-[#0F1E3C]/40">{order.contactName} · {order.contactPhone}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Obs */}
          {order.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <p className="text-xs text-amber-700"><span className="font-semibold">Obs:</span> {order.notes}</p>
            </div>
          )}

          {/* Confirmando — banner de espera */}
          {isConfirm && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-purple-50 border border-purple-200">
              <Clock size={14} className="text-purple-500 flex-shrink-0 animate-pulse" />
              <div>
                <p className="text-xs font-bold text-purple-700">Aguardando confirmação do cliente</p>
                <p className="text-[10px] mt-0.5 text-purple-500">
                  Mensagem enviada via WhatsApp. Avance manualmente quando confirmar com o cliente.
                </p>
              </div>
            </div>
          )}

          {/* Pronto p/ Retirada */}
          {isPronte && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-orange-700">Pronto para retirada — aguardando cliente</p>
              {order.totalValue && (
                <p className="text-base font-black text-orange-700">R$ {Number(order.totalValue).toFixed(2).replace(".", ",")}</p>
              )}
            </div>
          )}

          {/* Pago — aguardando confirmação de entrega */}
          {isPago && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-green-700">Pagamento confirmado — confirme a entrega</p>
              {order.totalValue && (
                <p className="text-base font-black text-green-700">R$ {Number(order.totalValue).toFixed(2).replace(".", ",")}</p>
              )}
            </div>
          )}

          {/* Itens agrupados */}
          <div className="space-y-3">
            {groups.map(group => (
              <div key={group.productName} className="bg-[#F4F6FB] rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#0F1E3C]/6">
                  <Package size={13} className="text-[#0F1E3C]/40 flex-shrink-0" />
                  <p className="text-xs font-bold text-[#0F1E3C] uppercase tracking-wide">{group.productName}</p>
                </div>
                <div className="divide-y divide-[#0F1E3C]/5">
                  {group.items.map(item => (
                    <div key={item._idx} className="flex items-center gap-3 px-4 py-2.5">
                      {/* Cor + Tam */}
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        {item.color && <span className="text-sm text-[#0F1E3C]/70 truncate">{item.color}</span>}
                        {item.color && item.size && <span className="text-[#0F1E3C]/20 text-xs">·</span>}
                        {item.size && (
                          <span className="text-xs font-bold text-[#0F1E3C]/50 bg-white border border-[#0F1E3C]/10 rounded-lg px-2 py-0.5 uppercase flex-shrink-0">
                            {item.size}
                          </span>
                        )}
                        {!item.color && !item.size && <span className="text-xs text-[#0F1E3C]/30 italic">sem variação</span>}
                      </div>

                      {/* Qty stepper — triagem, confirmação e em_separacao */}
                      {(isTriagem || isConfirm || isSeparacao) && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => setQty(item._idx, item.qty - 1)}
                            className="w-7 h-7 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-sm font-bold flex items-center justify-center">−</button>
                          <span className="w-8 text-center text-sm font-black text-[#0F1E3C]">{item.qty}</span>
                          <button onClick={() => setQty(item._idx, item.qty + 1)}
                            className="w-7 h-7 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-sm font-bold flex items-center justify-center">+</button>
                        </div>
                      )}

                      {/* Qty somente leitura */}
                      {!isTriagem && !isConfirm && !isSeparacao && (
                        <span className="text-sm font-black text-[#0F1E3C] flex-shrink-0 w-10 text-right">
                          {item.qtyConfirmed ?? item.qty}
                        </span>
                      )}

                      {/* Delete — triagem, confirmação e em_separacao */}
                      {(isTriagem || isConfirm || isSeparacao) && (
                        <button onClick={() => removeItem(item._idx)}
                          className="w-7 h-7 rounded-lg text-[#0F1E3C]/20 hover:text-red-400 hover:bg-red-50 flex items-center justify-center flex-shrink-0 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(isTriagem || isSeparacao || isConfirm) && (
              addingItem ? (
                <div className="rounded-2xl border border-dashed border-purple-300 bg-purple-50/50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-700">
                      {addProd ? addProd.name : "Selecionar produto"}
                    </span>
                    <button onClick={cancelAddItem} className="text-[#0F1E3C]/30 hover:text-[#0F1E3C]">
                      <X size={14} />
                    </button>
                  </div>

                  {!addProd ? (
                    <select
                      autoFocus
                      value=""
                      onChange={e => {
                        const p = products.find(p => p.id === e.target.value) ?? null
                        if (p) selectAddProduct(p)
                      }}
                      className="w-full border border-purple-200 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] bg-white focus:outline-none">
                      <option value="">Selecionar produto...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <>
                      {addProd.colors.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {addProd.colors.map(c => (
                            <button key={c} type="button" onClick={() => chooseAddColor(c)}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                                addColor === c
                                  ? "bg-purple-600 text-white border-purple-600"
                                  : "bg-white border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:border-purple-300"
                              }`}>
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                      {addProd.sizes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {addProd.sizes.map(s => (
                            <button key={s} type="button" onClick={() => chooseAddSize(s)}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                                addSize === s
                                  ? "bg-purple-600 text-white border-purple-600"
                                  : "bg-white border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:border-purple-300"
                              }`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <button onClick={startAddItem}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-purple-200 text-xs text-purple-500 hover:bg-purple-50 transition-colors">
                  <Plus size={13} /> Adicionar item
                </button>
              )
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-[#0F1E3C]/40">Total</span>
            <span className="text-sm font-black text-[#0F1E3C]">{totalQty} unidades</span>
          </div>

          {/* Imprimir — disponível a partir do confirmando */}
          {(isConfirm || isSeparacao || isPronte || isPago) && (
            <div className="space-y-2 pt-1">
              {needsReprint && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-amber-700">Pedido alterado — reimprimir ficha atualizada</p>
                </div>
              )}
              {hasPrinted && !needsReprint && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                  <Check size={11} className="text-green-500 flex-shrink-0" />
                  <p className="text-xs text-green-700 font-medium">Ficha já impressa</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
                  <button onClick={() => setPrintFormat("a4")}
                    className={`px-3 py-2 transition-colors ${printFormat === "a4" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>A4</button>
                  <button onClick={() => setPrintFormat("thermal")}
                    className={`px-3 py-2 transition-colors ${printFormat === "thermal" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>4×6</button>
                </div>
                <button onClick={handlePrint}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    needsReprint
                      ? "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
                      : "border-[#0F1E3C]/10 text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6"
                  }`}>
                  {needsReprint ? <RotateCcw size={14} /> : <Printer size={14} />}
                  {hasPrinted ? (needsReprint ? "Reimprimir Ficha" : "Reimprimir") : "Imprimir Ficha"}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8 space-y-2.5">
          {isPronte && !isPaid && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider block">
                Vencimento *
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => { setDueDate(e.target.value); setError("") }}
                className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-2">

            {/* Cancelar — não mostra em concluido/cancelado */}
            {!isDone && (
              <button onClick={() => setShowCancel(true)} disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
                Cancelar
              </button>
            )}

            {/* TRIAGEM: confirmar pedido — manda lista pro cliente confirmar */}
            {isTriagem && (
              <button onClick={handleEnviarConfirmar} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                Confirmar Pedido
              </button>
            )}

            {/* CONFIRMANDO: adicionar item + avançar */}
            {isConfirm && (
              <button onClick={handleAvancarManual} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Avançar para Separação <ChevronRight size={14} />
              </button>
            )}

            {/* EM SEPARAÇÃO: marcar como pronto */}
            {isSeparacao && (
              <button onClick={handleMarcarPronte} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Marcar como Pronto <ChevronRight size={14} /></>}
              </button>
            )}

            {/* PRONTO: à vista → confirmar pagamento | a prazo → concluir direto */}
            {isPronte && (
              <>
                {order.paymentTermEnabled && (
                  <div
                    className="flex items-center gap-2 bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-xl px-3 py-2.5 cursor-pointer select-none"
                    onClick={() => {
                      const next = !isPaid
                      setIsPaid(next)
                      if (!next && !dueDate && order.paymentTermType === "days" && order.paymentTermDays) {
                        setDueDate(subDaysBR(-order.paymentTermDays))
                      }
                      setError("")
                    }}
                  >
                    <Toggle on={isPaid} onChange={() => {}} onColor="bg-emerald-500" />
                    <p className="text-xs font-semibold text-[#0F1E3C] whitespace-nowrap">{isPaid ? "À vista" : "A prazo"}</p>
                  </div>
                )}
                <button onClick={isPaid ? handleMarcarPago : handleConcluirPrazo} disabled={saving}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors ${
                    isPaid ? "bg-green-600 hover:bg-green-700" : "bg-[#0F1E3C] hover:bg-[#1B2A4A]"
                  }`}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {isPaid ? "Confirmar Pagamento" : "Concluir a Prazo"}
                </button>
              </>
            )}

            {/* PAGO: confirmar entrega */}
            {isPago && (
              <button onClick={handleConfirmarRetirada} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirmar Entrega
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Print */}
      {showPrint && (
        <PrintSheet order={order} items={items} format={printFormat} onDone={() => setShowPrint(false)} />
      )}

      {/* Cancel dialog */}
      {showCancel && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F1E3C]">Cancelar pedido {order.number}?</h3>
            <div className="flex items-center gap-3">
              <Toggle on={notifyClient} onChange={() => setNotifyClient(v => !v)} />
              <p className="text-sm font-medium text-[#0F1E3C]">Notificar cliente via WhatsApp</p>
            </div>
            {notifyClient && (
              <textarea value={cancelMsg} onChange={e => setCancelMsg(e.target.value)} rows={3}
                className="w-full border border-[#0F1E3C]/10 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-[#F4F6FB] focus:outline-none resize-none" />
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowCancel(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6">Voltar</button>
              <button onClick={confirmCancel} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                {saving ? "..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
