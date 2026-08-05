"use client"

import { useState, useEffect } from "react"
import { X, Printer, Check, Trash2, Plus, ChevronRight, Loader2, Package, Clock, AlertTriangle, RotateCcw } from "lucide-react"
import type { Order, OrderItem } from "./page"
import PrintSheet from "./PrintSheet"
import { printWhenReady } from "@/components/print/print-utils"
import Toggle from "@/components/Toggle"
import ConfirmDialog from "@/components/ConfirmDialog"

type Props = {
  order: Order
  onClose: () => void
  onRefresh: () => void
}

const STATUS_LABEL: Record<string, string> = {
  triagem:      "Triagem",
  em_separacao: "Em Separação",
  pronto:       "Pronto p/ Retirada",
  concluido:    "Retirado",
  cancelado:    "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:      "bg-amber-100 text-amber-700",
  em_separacao: "bg-blue-100 text-blue-700",
  pronto:       "bg-orange-100 text-orange-700",
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
  const [orderPrint,    setOrderPrint]    = useState(false) // "Ordem do Pedido" 2 vias, ao concluir separação
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
  const [askingPayment, setAskingPayment] = useState(false)
  const [dueDate,       setDueDate]       = useState("")
  const [error,         setError]         = useState("")
  const [sendingConfirmation, setSendingConfirmation] = useState(false)
  const [sendingAlteration, setSendingAlteration] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ title: string; run: () => Promise<void> } | null>(null)
  const [confirming,    setConfirming]    = useState(false)

  function itemsHash(list: OrderItem[]) {
    return list.map(i => `${i.productName}|${i.color}|${i.size}|${i.qty}`).join(",")
  }
  const currentHash  = itemsHash(items)
  const needsReprint = hasPrinted && currentHash !== printedHash

  // Rastreia edição manual de quantidade feita em Em Separação (comparado ao que
  // já está salvo no servidor) — dispara o fluxo de Reconfirmar Pedido.
  const [lastSavedHash, setLastSavedHash] = useState(() => itemsHash(order.items))
  const hasPendingEdit = currentHash !== lastSavedHash

  async function runConfirmed() {
    if (!pendingAction) return
    setConfirming(true)
    try {
      await pendingAction.run()
    } finally {
      setConfirming(false)
      setPendingAction(null)
    }
  }

  function handlePrint() {
    setPrintedHash(currentHash)
    setHasPrinted(true)
    try { localStorage.setItem(`print_${order.id}`, JSON.stringify({ hash: currentHash })) } catch { /* ignora */ }
    setShowPrint(true)
    printWhenReady()
  }

  const isTriagem      = order.status === "triagem"
  const aguardandoConf = isTriagem && !!order.confirmationRequestedAt
  const isSeparacao    = order.status === "em_separacao"
  const isPronte       = order.status === "pronto"
  const isDone         = order.status === "concluido" || order.status === "cancelado"

  const groups   = groupItems(items)
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)

  function setQty(idx: number, val: number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(1, val) } : item))
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

  // TRIAGEM — solicita confirmação ao cliente, fica na mesma coluna (sub-estado)
  async function handleSolicitarConfirmacao() {
    setSendingConfirmation(true)
    try {
      await saveItems()
      await fetch(`/api/orders/${order.id}/request-confirmation`, { method: "POST" })
      onRefresh()
    } finally { setSendingConfirmation(false) }
  }

  // TRIAGEM (aguardando) — operador confirma que o cliente respondeu OK
  async function handleClienteConfirmou() {
    setSaving(true)
    try {
      await postStatus("em_separacao")
      onRefresh()
    } finally { setSaving(false) }
  }

  // EM SEPARAÇÃO — operador editou quantidade manualmente: reconfirma com o cliente
  async function handleReconfirmarPedido() {
    setSendingAlteration(true)
    try {
      await saveItems()
      await fetch(`/api/orders/${order.id}/alert-alteration`, { method: "POST" })
      setLastSavedHash(currentHash)
      onRefresh()
    } finally { setSendingAlteration(false) }
  }

  // EM SEPARAÇÃO — sem alteração pendente: conclui a separação, imprime a Ordem
  // do Pedido (2 vias) automaticamente e avança pra Pronto p/ Retirada.
  async function handleConcluirSeparacao() {
    setSaving(true)
    try {
      await saveItems()
      await postStatus("pronto")
      onRefresh()
      setOrderPrint(true)
      printWhenReady()
    } finally { setSaving(false) }
  }

  // PRONTO — Concluir Entrega pergunta pagamento antes de fechar o ciclo
  async function handleConcluirPago() {
    setSaving(true)
    try {
      await postStatus("concluido", { paid: true })
      onRefresh()
      onClose()
    } finally { setSaving(false) }
  }

  async function handleConcluirPrazo() {
    if (!dueDate) { setError("Informe a data de vencimento pra concluir a prazo."); return }
    setSaving(true)
    setError("")
    try {
      await postStatus("concluido", { paid: false, dueDate })
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

          {/* Triagem — aguardando confirmação do cliente */}
          {aguardandoConf && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-purple-50 border border-purple-200">
              <Clock size={14} className="text-purple-500 flex-shrink-0 animate-pulse" />
              <div>
                <p className="text-xs font-bold text-purple-700">Aguardando confirmação do cliente</p>
                <p className="text-[10px] mt-0.5 text-purple-500">
                  Mensagem enviada via WhatsApp. Marque quando o cliente confirmar.
                </p>
              </div>
            </div>
          )}

          {/* Em Separação — aviso de estoque insuficiente (só informativo) */}
          {isSeparacao && order.stockAlert && order.stockAlert.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-bold text-amber-700">⚠ Estoque insuficiente — aviso, o pedido não muda sozinho</p>
              {order.stockAlert.map((a, i) => (
                <p key={i} className="text-xs text-amber-700">
                  {[a.productName, a.color, a.size].filter(Boolean).join(" ")} — pediu <b>{a.requested}</b>, disponível <b>{a.available}</b>
                </p>
              ))}
              <p className="text-[10px] text-amber-600 pt-1">Ajuste o item manualmente se quiser refletir isso no pedido.</p>
            </div>
          )}

          {/* Em Separação — alteração manual já mandada, aguardando resposta */}
          {isSeparacao && !hasPendingEdit && order.alterationSent && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-xs font-bold text-red-700">🔁 Pedido alterado — cliente já foi avisado do novo total</p>
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

            {(isTriagem || isSeparacao) && (
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

          {/* Imprimir Ficha de Separação — disponível a partir de em_separacao */}
          {(isSeparacao || isPronte) && (
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
                  {hasPrinted ? (needsReprint ? "Reimprimir Ficha" : "Reimprimir") : "Imprimir Ficha de Separação"}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8 space-y-2.5">

          {/* PRONTO — pergunta de pagamento ao concluir a entrega */}
          {isPronte && askingPayment && (
            <div className="rounded-xl border border-[#0F1E3C]/10 bg-[#F4F6FB] p-3 space-y-2.5">
              <p className="text-xs font-bold text-[#0F1E3C]">Pedido já foi pago?</p>
              <div className="flex gap-2">
                <button onClick={handleConcluirPago} disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50">
                  Sim
                </button>
                <button onClick={() => setAskingPayment(v => !v)} disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold disabled:opacity-50">
                  Não
                </button>
              </div>
              {/* "Não" já revela o campo de prazo abaixo (mesmo painel, sem trocar de tela) */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider block">
                  Se não pagou — vencimento *
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setError("") }}
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
                <button onClick={handleConcluirPrazo} disabled={saving}
                  className="w-full py-2 rounded-xl border border-[#0F1E3C]/15 text-[#0F1E3C] text-sm font-semibold hover:bg-[#0F1E3C]/4 disabled:opacity-50">
                  Concluir a Prazo
                </button>
              </div>
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

            {/* TRIAGEM (novo): solicitar confirmação ao cliente */}
            {isTriagem && !aguardandoConf && (
              <button onClick={handleSolicitarConfirmacao} disabled={sendingConfirmation}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {sendingConfirmation ? <Loader2 size={13} className="animate-spin" /> : null}
                Solicitar Confirmação
              </button>
            )}

            {/* TRIAGEM (aguardando): operador marca que o cliente confirmou */}
            {isTriagem && aguardandoConf && (
              <button
                onClick={() => setPendingAction({ title: "Cliente confirmou — avançar pedido para Separação?", run: handleClienteConfirmou })}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Cliente confirmou <ChevronRight size={14} />
              </button>
            )}

            {/* EM SEPARAÇÃO — operador alterou quantidade manualmente: reconfirma com o cliente */}
            {isSeparacao && hasPendingEdit && (
              <button onClick={handleReconfirmarPedido} disabled={sendingAlteration}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {sendingAlteration ? <Loader2 size={14} className="animate-spin" /> : <>🔁 Reconfirmar Pedido</>}
              </button>
            )}

            {/* EM SEPARAÇÃO — sem alteração pendente: conclui e imprime a Ordem (2 vias) */}
            {isSeparacao && !hasPendingEdit && (
              <button
                onClick={() => setPendingAction({ title: "Concluir separação? Vai imprimir a Ordem do Pedido (2 vias) e avançar pra Pronto.", run: handleConcluirSeparacao })}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Concluir Separação <ChevronRight size={14} /></>}
              </button>
            )}

            {/* PRONTO: abre a pergunta de pagamento */}
            {isPronte && !askingPayment && (
              <button onClick={() => setAskingPayment(true)} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors">
                <Check size={14} /> Concluir Entrega
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Print — ficha de separação (manual) */}
      {showPrint && (
        <PrintSheet order={order} items={items} format={printFormat} onDone={() => setShowPrint(false)} />
      )}

      {/* Print — Ordem do Pedido, 2 vias, automático ao Concluir Separação */}
      {orderPrint && (
        <PrintSheet order={order} items={items} format="a4" title="Ordem do Pedido" onDone={() => setOrderPrint(false)} />
      )}

      {/* Confirmação de avanço de estágio */}
      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.title}
          confirming={confirming}
          onConfirm={runConfirmed}
          onCancel={() => setPendingAction(null)}
        />
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
