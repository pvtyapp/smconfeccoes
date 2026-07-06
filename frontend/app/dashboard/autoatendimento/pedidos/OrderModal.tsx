"use client"

import { useState, useEffect } from "react"
import { X, Printer, Check, Trash2, Plus, ChevronRight, Loader2, Package, Clock, AlertTriangle, RotateCcw } from "lucide-react"
import type { Order, OrderItem } from "./page"

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

  async function handleAtualizarReenviar() {
    setSaving(true)
    try {
      const changes: Array<{
        productName: string; color: string | null; size: string | null
        oldQty: number; newQty: number
      }> = []
      for (const orig of order.items) {
        const cur = items.find(i =>
          i.productName === orig.productName &&
          (i.color ?? "") === (orig.color ?? "") &&
          (i.size ?? "") === (orig.size ?? "")
        )
        const newQty = cur ? cur.qty : 0
        if (newQty !== orig.qty) {
          changes.push({ productName: orig.productName, color: orig.color ?? null, size: orig.size ?? null, oldQty: orig.qty, newQty })
        }
      }
      await saveItems()
      await postStatus("em_separacao", changes.length ? { changes } : {})
      onRefresh()
    } finally { setSaving(false) }
  }

  async function handleAvancarManual() {
    setSaving(true)
    try {
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

                      {/* Qty stepper — triagem e em_separacao */}
                      {(isTriagem || isSeparacao) && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => setQty(item._idx, item.qty - 1)}
                            className="w-7 h-7 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-sm font-bold flex items-center justify-center">−</button>
                          <span className="w-8 text-center text-sm font-black text-[#0F1E3C]">{item.qty}</span>
                          <button onClick={() => setQty(item._idx, item.qty + 1)}
                            className="w-7 h-7 rounded-lg bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 text-sm font-bold flex items-center justify-center">+</button>
                        </div>
                      )}

                      {/* Qty somente leitura */}
                      {!isTriagem && !isSeparacao && (
                        <span className="text-sm font-black text-[#0F1E3C] flex-shrink-0 w-10 text-right">
                          {item.qtyConfirmed ?? item.qty}
                        </span>
                      )}

                      {/* Delete — triagem e em_separacao */}
                      {(isTriagem || isSeparacao) && (
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
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8">
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

            {/* EM SEPARAÇÃO: atualizar+reenviar ou marcar como pronto */}
            {isSeparacao && (
              <>
                <button onClick={handleAtualizarReenviar} disabled={saving}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-sm font-semibold disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  Atualizar e Reenviar
                </button>
                <button onClick={handleMarcarPronte} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Marcar como Pronto <ChevronRight size={14} /></>}
                </button>
              </>
            )}

            {/* PRONTO: confirmar pagamento */}
            {isPronte && (
              <button onClick={handleMarcarPago} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                ✓ Confirmar Pagamento
              </button>
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
              <button type="button" onClick={() => setNotifyClient(v => !v)}
                className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${notifyClient ? "bg-[#4361EE]" : "bg-[#0F1E3C]/15"}`}
                style={{ height: "22px" }}>
                <span className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${notifyClient ? "translate-x-5" : "translate-x-0.5"}`} style={{ width: "18px", height: "18px" }} />
              </button>
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

// ─── Print Sheet ─────────────────────────────────────────────────────────────

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

function PrintSheet({ order, items, format, onDone }: {
  order: Order; items: OrderItem[]; format: "a4" | "thermal"; onDone: () => void
}) {
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const orderDate = new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const valor = order.totalValue
    ? `R$ ${Number(order.totalValue).toFixed(2).replace(".", ",")}`
    : "—"

  if (format === "thermal") {
    return (
      <div className="hidden print:block fixed inset-0 bg-white z-[100]">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-label, .print-label * { visibility: visible !important; }
            .print-label { position: fixed; top: 0; left: 0; width: 100mm; height: 150mm; overflow: hidden; box-sizing: border-box; }
            @page { size: 100mm 150mm; margin: 0; }
          }
        `}</style>
        <div className="print-label" style={{
          width: "100mm", height: "150mm", padding: "5mm 6mm",
          fontFamily: "'Arial', sans-serif", color: NAVY,
          display: "flex", flexDirection: "column", boxSizing: "border-box",
        }}>
          {/* Cabeçalho */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3mm" }}>
            <img src="/smsemfundo.png" alt="SM" style={{ height: "28px", width: "auto", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: "900", letterSpacing: "-0.3px", lineHeight: 1 }}>SM CONFECÇÕES</div>
              <div style={{ fontSize: "7px", color: "#666", marginTop: "2px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
            </div>
          </div>

          {/* Barra título */}
          <div style={{
            background: NAVY, color: "white", borderRadius: "3px",
            padding: "3px 7px", display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: "3mm",
          }}>
            <span style={{ fontWeight: "800", fontSize: "9px", letterSpacing: "0.8px" }}>FICHA DE SEPARAÇÃO</span>
            <span style={{ fontSize: "7px", opacity: 0.75 }}>{printDate} {printTime}</span>
          </div>

          {/* Pedido + Cliente */}
          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm", background: NAVY_LIGHT,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
              <span style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Pedido</span>
              <span style={{ fontSize: "12px", fontWeight: "900", color: NAVY }}>{order.number}</span>
            </div>
            <div style={{ borderTop: "1px solid #d0d5e0", paddingTop: "4px" }}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: NAVY }}>{order.contactName}</div>
              <div style={{ fontSize: "9px", color: "#555", marginTop: "1px" }}>{order.contactPhone}</div>
            </div>
            {order.notes && (
              <div style={{ borderTop: "1px solid #d0d5e0", marginTop: "4px", paddingTop: "3px" }}>
                <span style={{ fontSize: "7px", color: "#888" }}>Obs: </span>
                <span style={{ fontSize: "8px", color: "#444" }}>{order.notes}</span>
              </div>
            )}
          </div>

          {/* Itens */}
          <div style={{ flex: 1, overflow: "hidden", marginBottom: "3mm" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
              <thead>
                <tr style={{ background: NAVY, color: "white" }}>
                  <th style={{ padding: "3px 5px", textAlign: "left", fontSize: "7px", fontWeight: "700" }}>PRODUTO / COR / TAM</th>
                  <th style={{ padding: "3px 5px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "24px" }}>QTD</th>
                  <th style={{ padding: "3px 5px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "18px" }}>✓</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e8eaf0" }}>
                    <td style={{ padding: "3px 5px", fontWeight: "600", fontSize: "9px" }}>
                      {item.productName}
                      {item.color ? <span style={{ fontWeight: "400", color: "#555" }}> · {item.color}</span> : null}
                      {item.size  ? <span style={{ fontWeight: "700", color: NAVY }}> {item.size}</span> : null}
                    </td>
                    <td style={{ padding: "3px 5px", textAlign: "center", fontWeight: "900", fontSize: "11px" }}>{item.qty}</td>
                    <td style={{ padding: "3px 5px", textAlign: "center" }}>
                      <div style={{ width: "11px", height: "11px", border: "1.5px solid #aaa", borderRadius: "2px", margin: "0 auto" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rodapé: total + valor + assinatura */}
          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: NAVY_LIGHT,
          }}>
            <div>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total</div>
              <div style={{ fontSize: "13px", fontWeight: "900", color: NAVY }}>{totalQty} un</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Valor</div>
              <div style={{ fontSize: "13px", fontWeight: "900", color: NAVY }}>{valor}</div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
            <div style={{ fontSize: "7px", color: "#666" }}>Assinatura do cliente</div>
          </div>
        </div>
        <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
      </div>
    )
  }

  // A4 — ≤8 itens: 2 colunas na mesma folha | >8 itens: 2 páginas
  const splitSheet = items.length <= 8

  function renderFicha(via: "LOJA" | "CLIENTE") {
    const pad = splitSheet ? "6mm 14mm 8mm 14mm" : "14mm 16mm"
    return (
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", padding: pad, color: NAVY }}>

        {/* ── Cabeçalho ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
          <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: splitSheet ? "46px" : "58px", width: "auto", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: splitSheet ? "16px" : "20px", fontWeight: "900", letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>
              SM CONFECÇÕES
            </div>
            <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>
              Av. Santa Cruz, 3088 — Franca / SP
            </div>
          </div>
          <div style={{
            border: `1.5px solid ${NAVY}`, borderRadius: "4px",
            padding: "3px 10px", textAlign: "center", flexShrink: 0,
          }}>
            <div style={{ fontSize: "6.5px", letterSpacing: "1.5px", color: NAVY, opacity: 0.6, textTransform: "uppercase" }}>via</div>
            <div style={{ fontSize: "9px", fontWeight: "800", letterSpacing: "1px", color: NAVY, textTransform: "uppercase" }}>{via}</div>
          </div>
        </div>

        {/* ── Barra título ── */}
        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "5px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "7px",
        }}>
          <span style={{ fontWeight: "800", fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase" }}>
            Ficha de Separação
          </span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        {/* ── Info do pedido ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          border: `1px solid #d8dde8`, borderRadius: "4px", overflow: "hidden",
          marginBottom: "7px",
        }}>
          {([
            ["Pedido", order.number],
            ["Data do pedido", orderDate],
            ["Hora de impressão", printTime],
          ] as [string, string][]).map(([label, val], i) => (
            <div key={i} style={{
              padding: "5px 8px",
              borderRight: i < 2 ? "1px solid #d8dde8" : "none",
              background: i % 2 === 0 ? NAVY_LIGHT : "white",
            }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
              <div style={{ fontSize: "10.5px", fontWeight: "700", color: NAVY, marginTop: "2px" }}>{val}</div>
            </div>
          ))}
        </div>

        {/* ── Dados do cliente ── */}
        <div style={{
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "6px 8px", marginBottom: "7px", background: NAVY_LIGHT,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Cliente</div>
              <div style={{ fontSize: splitSheet ? "12px" : "15px", fontWeight: "800", color: NAVY, marginTop: "1px" }}>
                {order.contactName}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Telefone</div>
              <div style={{ fontSize: "10px", fontWeight: "600", color: NAVY, marginTop: "1px" }}>{order.contactPhone}</div>
            </div>
          </div>
          {order.notes && (
            <div style={{ borderTop: "1px solid #ccd0da", marginTop: "5px", paddingTop: "4px" }}>
              <span style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Obs: </span>
              <span style={{ fontSize: "8.5px", color: "#444" }}>{order.notes}</span>
            </div>
          )}
        </div>

        {/* ── Tabela de itens ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "7px" }}>
          <thead>
            <tr style={{ background: NAVY, color: "white" }}>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "20px", fontWeight: "700", letterSpacing: "0.5px" }}>#</th>
              <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "7px", fontWeight: "700", letterSpacing: "0.5px" }}>PRODUTO</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "58px", fontWeight: "700", letterSpacing: "0.5px" }}>COR</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "32px", fontWeight: "700", letterSpacing: "0.5px" }}>TAM</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "28px", fontWeight: "700", letterSpacing: "0.5px" }}>QTD</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "22px", fontWeight: "700" }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "8px", color: "#888" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px", fontSize: "9px", fontWeight: "600", color: NAVY }}>{item.productName}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", color: "#444" }}>{item.color || "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", fontWeight: "700", color: NAVY }}>{item.size || "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "12px", fontWeight: "900", color: NAVY }}>{item.qty}</td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>
                  <div style={{ width: "13px", height: "13px", border: "1.5px solid #aaa", borderRadius: "2px", margin: "0 auto" }} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: NAVY, color: "white" }}>
              <td colSpan={4} style={{ padding: "5px 6px", fontSize: "8px", fontWeight: "700", letterSpacing: "0.5px" }}>TOTAL GERAL</td>
              <td style={{ padding: "5px 6px", textAlign: "center", fontSize: "13px", fontWeight: "900" }}>{totalQty}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {/* ── Valor ── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "5px 10px", marginBottom: "10px", background: NAVY_LIGHT,
        }}>
          <span style={{ fontSize: "8px", color: "#666", textTransform: "uppercase", letterSpacing: "0.8px" }}>Valor total do pedido</span>
          <span style={{ fontSize: "15px", fontWeight: "900", color: NAVY }}>{valor}</span>
        </div>

        {/* ── Assinaturas ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "4px" }}>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Atendente</div>
            </div>
          </div>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Data de retirada: ___/___/______</div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
            <div style={{ fontSize: "7px", color: "#666" }}>Assinatura do cliente</div>
          </div>
        </div>

        {/* ── Rodapé ── */}
        <div style={{
          marginTop: "10px", paddingTop: "6px", borderTop: "1px dashed #ccc",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>{order.number} · {printDate}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[100]">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-a4, .print-a4 * { visibility: visible !important; }
          .print-a4 { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
      <div className="print-a4">
        {splitSheet ? (
          <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100%" }}>
            <div style={{ borderBottom: "1.5px dashed #bbb", overflow: "hidden" }}>
              {renderFicha("LOJA")}
            </div>
            <div style={{ overflow: "hidden" }}>{renderFicha("CLIENTE")}</div>
          </div>
        ) : (
          <>
            {renderFicha("LOJA")}
            <div style={{ pageBreakBefore: "always" }}>{renderFicha("CLIENTE")}</div>
          </>
        )}
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
