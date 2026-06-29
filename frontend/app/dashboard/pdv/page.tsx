"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  Search, RefreshCw, ShoppingCart, X, Plus, Minus,
  Loader2, UserPlus, Store, Check, Receipt,
  ChevronDown, ChevronUp, Printer,
} from "lucide-react"
import { todayBR, dateBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"
import PdvReceiptModal, { type SaleReceipt } from "./PdvReceiptModal"

// ─── Types ────────────────────────────────────────────────────────────────────

type Variant = {
  variantId: string
  productId: string
  productName: string
  color: string
  size: string
  salePrice: number
  currentStock: number
}

type Product = {
  id: string
  name: string
  salePrice: number | null
  stockEnabled: boolean
  precoPorMetro: boolean
  status: string
}

type Contact = {
  id: number
  name: string | null
  phone: string | null
  precoExclusivo: boolean | null
  paymentTermEnabled: boolean | null
  paymentTermType: string | null
  paymentTermDays: number | null
}

type CartItem = {
  key: string
  variantId?: string
  productId?: string
  productName: string
  color: string
  size: string
  qty: number
  metros?: number
  precoPorMetro?: boolean
  unitPrice: number
  maxStock?: number
}

type CartGroup = {
  groupKey: string
  productName: string
  unitPrice: number
  items: CartItem[]
}

type RecentOrder = {
  id: number
  number: string
  contactName: string | null
}

type PayMethod = "dinheiro" | "pix" | "debito" | "credito" | "prazo"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XGG", "XXXL"]

function sizeSort(a: string, b: string) {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b)
  if (ai === -1 && bi === -1) return a.localeCompare(b)
  if (ai === -1) return 1
  if (bi === -1) return -1
  return ai - bi
}

function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—"
  const p = phone.replace(/\D/g, "")
  if (p.length === 13) return `+${p.slice(0,2)} (${p.slice(2,4)}) ${p.slice(4,9)}-${p.slice(9)}`
  if (p.length === 11) return `(${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}`
  return phone
}

function todayISO() { return todayBR() }

function normalizePhoneLocal(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  return digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`
}

const PAY_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix",      label: "Pix"      },
  { value: "debito",   label: "Débito"   },
  { value: "credito",  label: "Crédito"  },
  { value: "prazo",    label: "Prazo"    },
]

const PAY_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", prazo: "Prazo",
}

function variantBtnClass(v: Variant, inCart: CartItem | undefined): string {
  const base = "relative flex flex-col items-center px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all min-w-[48px]"
  if (v.currentStock < 0)  return `${base} border-red-300 bg-red-50 text-red-400 cursor-not-allowed`
  if (v.currentStock === 0) return `${base} border-orange-300 bg-orange-50 text-orange-400 cursor-not-allowed`
  if (inCart)               return `${base} border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]`
  return `${base} border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:bg-[#4361EE]/6`
}

function variantStockClass(v: Variant, inCart: CartItem | undefined): string {
  if (v.currentStock < 0)  return "text-red-400"
  if (v.currentStock === 0) return "text-orange-400"
  if (inCart)               return "text-[#4361EE]/70"
  return "text-[#0F1E3C]/30"
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PDVPage() {
  const [balance,  setBalance]  = useState<Variant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading,  setLoading]  = useState(true)

  const [search, setSearch] = useState("")
  const [cart,   setCart]   = useState<CartItem[]>([])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  function toggleGroup(productId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  // Customer
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [contactSearch,   setContactSearch]   = useState("")
  const [showDrop,        setShowDrop]        = useState(false)
  const [newMode,         setNewMode]         = useState(false)
  const [newName,         setNewName]         = useState("")
  const [newPhone,        setNewPhone]        = useState("")
  const [duplicateFound,  setDuplicateFound]  = useState<Contact | null>(null)
  const [isBalcao,        setIsBalcao]        = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Preço Exclusivo
  const [priceOverrides,  setPriceOverrides]  = useState<Record<string, string>>({})
  const [exclusivoMode,   setExclusivoMode]   = useState<"item" | "desconto">("item")
  const [descontoTipo,    setDescontoTipo]    = useState<"percent" | "reais">("percent")
  const [descontoValor,   setDescontoValor]   = useState("")

  // Payment
  const [payMethod, setPayMethod] = useState<PayMethod>("pix")
  const [dueDate,   setDueDate]   = useState("")
  const [notes,     setNotes]     = useState("")

  // Metro inputs
  const [metroValues, setMetroValues] = useState<Record<string, string>>({})

  // Sale
  const [saving,       setSaving]       = useState(false)
  const [autoPrint,    setAutoPrint]    = useState(false)
  const [lastSale,     setLastSale]     = useState<{ number: string; total: number } | null>(null)
  const [saleError,    setSaleError]    = useState("")
  const [receipt,      setReceipt]      = useState<SaleReceipt | null>(null)
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])

  // Derived — declared early so price calculations can use activeContact
  const activeContact     = selectedContact ?? duplicateFound
  const hasClientOrBalcao = isBalcao || !!activeContact || (newMode && !!newPhone.trim())

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false)
    }
    if (showDrop) document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [showDrop])

  // Auto-compute dueDate when client with paymentTermType === "days" is selected
  useEffect(() => {
    const c = selectedContact ?? duplicateFound
    if (c?.paymentTermEnabled && c.paymentTermType === "days" && c.paymentTermDays) {
      const [y, mo, day] = todayBR().split("-").map(Number)
      const d = new Date(y, mo - 1, day + Number(c.paymentTermDays))
      setDueDate(dateBR(d))
    }
  }, [selectedContact, duplicateFound])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bRes, pRes, cRes] = await Promise.all([
        fetch("/api/stock/balance"),
        fetch("/api/products"),
        fetch("/api/clientes"),
      ])
      if (bRes.ok) {
        const raw: Variant[] = await bRes.json()
        setBalance(raw.map(v => ({ ...v, salePrice: Number(v.salePrice) || 0 })))
      }
      if (pRes.ok) {
        const raw: Product[] = await pRes.json()
        setProducts(raw.map(p => ({ ...p, salePrice: p.salePrice != null ? Number(p.salePrice) : null })))
      }
      if (cRes.ok) setContacts(await cRes.json())
      const recRes = await fetch("/api/pdv")
      if (recRes.ok) setRecentOrders(await recRes.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Product groups ─────────────────────────────────────────────────────────

  const stockGroups = useMemo(() => {
    const map = new Map<string, { productName: string; variants: Variant[] }>()
    for (const v of balance) {
      if (!map.has(v.productId)) map.set(v.productId, { productName: v.productName, variants: [] })
      map.get(v.productId)!.variants.push(v)
    }
    return [...map.entries()].map(([productId, g]) => ({
      productId,
      productName: g.productName,
      variants: g.variants,
      price: g.variants[0]?.salePrice ?? 0,
    }))
  }, [balance])

  const nonStockProducts = useMemo(
    () => products.filter(p => !p.stockEnabled && p.status === "active"),
    [products]
  )

  const q = search.toLowerCase()
  const filteredStock = useMemo(
    () => q ? stockGroups.filter(g => g.productName.toLowerCase().includes(q)) : stockGroups,
    [stockGroups, q]
  )
  const filteredNonStock = useMemo(
    () => q ? nonStockProducts.filter(p => p.name.toLowerCase().includes(q)) : nonStockProducts,
    [nonStockProducts, q]
  )

  // ── Cart ops ───────────────────────────────────────────────────────────────

  function addVariant(v: Variant) {
    if (v.currentStock <= 0) return
    setCart(prev => {
      const ex = prev.find(i => i.key === v.variantId)
      if (ex) {
        if (ex.qty >= (ex.maxStock ?? Infinity)) return prev
        return prev.map(i => i.key === v.variantId ? { ...i, qty: i.qty + 1 } : i)
      }
      return [...prev, {
        key: v.variantId,
        variantId: v.variantId,
        productId: v.productId,
        productName: v.productName,
        color: v.color,
        size: v.size,
        qty: 1,
        unitPrice: Number(v.salePrice) || 0,
        maxStock: v.currentStock,
      }]
    })
  }

  function addProduct(p: Product) {
    const key = `p-${p.id}`
    setCart(prev => {
      const ex = prev.find(i => i.key === key)
      if (ex) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { key, productName: p.name, color: "", size: "", qty: 1, unitPrice: Number(p.salePrice) || 0 }]
    })
  }

  function addMetroProduct(p: Product, metros: number) {
    if (isNaN(metros) || metros <= 0) return
    const key = `p-${p.id}`
    setCart(prev => {
      const ex = prev.find(i => i.key === key)
      if (ex) return prev.map(i => i.key === key ? { ...i, metros } : i)
      return [...prev, { key, productName: p.name, color: "", size: "", qty: 1, metros, precoPorMetro: true, unitPrice: Number(p.salePrice) || 0 }]
    })
  }

  function updateMetros(key: string, metros: number) {
    if (isNaN(metros) || metros <= 0) {
      setCart(prev => prev.filter(i => i.key !== key))
      return
    }
    setCart(prev => prev.map(i => i.key === key ? { ...i, metros } : i))
  }

  function updateQty(key: string, delta: number) {
    setCart(prev => prev
      .map(i => i.key === key
        ? { ...i, qty: Math.max(0, Math.min(i.qty + delta, i.maxStock ?? 999)) }
        : i
      )
      .filter(i => i.qty > 0)
    )
  }

  function setQtyDirect(key: string, val: number) {
    if (isNaN(val) || val < 1) return
    setCart(prev => prev.map(i =>
      i.key === key ? { ...i, qty: Math.min(val, i.maxStock ?? 999) } : i
    ))
  }

  const baseTotal = cart.reduce((s, i) => {
    return s + (i.precoPorMetro ? (i.metros ?? 0) * i.unitPrice : i.qty * i.unitPrice)
  }, 0)
  const cartCount = cart.reduce((s, i) => s + (i.precoPorMetro ? 1 : i.qty), 0)

  const cartGroups = useMemo((): CartGroup[] => {
    const groups: CartGroup[] = []
    const idxMap = new Map<string, number>()
    for (const item of cart) {
      if (item.variantId && item.productId) {
        if (idxMap.has(item.productId)) {
          groups[idxMap.get(item.productId)!].items.push(item)
        } else {
          idxMap.set(item.productId, groups.length)
          groups.push({ groupKey: item.productId, productName: item.productName, unitPrice: item.unitPrice, items: [item] })
        }
      } else {
        groups.push({ groupKey: item.key, productName: item.productName, unitPrice: item.unitPrice, items: [item] })
      }
    }
    return groups
  }, [cart])

  const discountAmount = (() => {
    if (!activeContact?.precoExclusivo || exclusivoMode !== "desconto") return 0
    const dv = parseFloat(descontoValor.replace(",", "."))
    if (isNaN(dv) || dv <= 0) return 0
    return descontoTipo === "percent"
      ? baseTotal * Math.min(dv, 100) / 100
      : Math.min(dv, baseTotal)
  })()

  const total = (() => {
    if (!activeContact?.precoExclusivo) return baseTotal
    if (exclusivoMode === "item") {
      return cart.reduce((s, i) => {
        const ov = priceOverrides[i.productId ?? i.key]
        const p = ov && ov.trim() ? parseFloat(ov.replace(",", ".")) : NaN
        const unitP = isNaN(p) || p < 0 ? i.unitPrice : p
        return s + (i.precoPorMetro ? (i.metros ?? 0) * unitP : i.qty * unitP)
      }, 0)
    }
    return Math.max(0, baseTotal - discountAmount)
  })()

  function effectiveUnitPrice(item: CartItem): number {
    if (!activeContact?.precoExclusivo) return item.unitPrice
    if (exclusivoMode === "item") {
      const ov = priceOverrides[item.productId ?? item.key]
      if (ov && ov.trim()) {
        const p = parseFloat(ov.replace(",", "."))
        if (!isNaN(p) && p >= 0) return p
      }
      return item.unitPrice
    }
    if (baseTotal === 0 || discountAmount === 0) return item.unitPrice
    const ratio = (baseTotal - discountAmount) / baseTotal
    return Math.round(item.unitPrice * ratio * 100) / 100
  }

  // ── Contact ────────────────────────────────────────────────────────────────

  const contactSuggestions = useMemo(() => {
    const cq = contactSearch.toLowerCase()
    if (!cq) return contacts.slice(0, 6)
    return contacts.filter(c =>
      (c.name ?? "").toLowerCase().includes(cq) || (c.phone ?? "").includes(cq)
    ).slice(0, 6)
  }, [contacts, contactSearch])

  function pickContact(c: Contact) {
    setSelectedContact(c)
    setContactSearch(c.name ?? c.phone ?? "")
    setShowDrop(false)
    setNewMode(false)
    setDuplicateFound(null)
    setIsBalcao(false)
  }

  function resetExclusivo() {
    setPriceOverrides({})
    setExclusivoMode("item")
    setDescontoTipo("percent")
    setDescontoValor("")
  }

  function clearContact() {
    setSelectedContact(null)
    setContactSearch("")
    setNewMode(false)
    setNewName("")
    setNewPhone("")
    setDuplicateFound(null)
    setIsBalcao(false)
    resetExclusivo()
    setPayMethod("pix")
    setDueDate("")
  }

  function pickContactWithClear(c: Contact) {
    resetExclusivo()
    setPayMethod("pix")
    setDueDate("")
    pickContact(c)
  }

  function selectBalcao() {
    setSelectedContact(null)
    setContactSearch("")
    setNewMode(false)
    setNewName("")
    setNewPhone("")
    setDuplicateFound(null)
    resetExclusivo()
    setPayMethod("pix")
    setDueDate("")
    setIsBalcao(true)
    setShowDrop(false)
  }

  function handlePhoneBlur() {
    if (!newPhone.trim()) { setDuplicateFound(null); return }
    const normalized = normalizePhoneLocal(newPhone)
    const found = contacts.find(c => normalizePhoneLocal(c.phone ?? "") === normalized)
    setDuplicateFound(found ?? null)
  }

  // ── Finalize ───────────────────────────────────────────────────────────────

  async function doSale(pm: PayMethod, dd: string, printAfter = false) {
    setSaleError("")
    setSaving(true)
    try {
      const effectiveContact = duplicateFound ?? selectedContact

      const contactData: Record<string, unknown> = {}
      if (effectiveContact) {
        contactData.contactId = effectiveContact.id
      } else if (newMode && newPhone.trim()) {
        contactData.newContact = { name: newName.trim() || null, phone: newPhone.trim() }
      }
      // isBalcao: no contactData → backend uses/creates Balcão contact

      const cartSnapshot = [...cart]

      const res = await fetch("/api/pdv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contactData,
          items: cartSnapshot.map(i => ({
            variantId:   i.variantId,
            productName: i.productName,
            color:       i.color || null,
            size:        i.precoPorMetro ? "m" : (i.size || null),
            qty:         i.precoPorMetro ? (i.metros ?? 0) : i.qty,
            unitPrice:   effectiveUnitPrice(i),
          })),
          paymentMethod: pm,
          dueDate: pm === "prazo" ? dd : undefined,
          notes:   notes.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro ao finalizar venda")

      // fire-and-forget WA (skip for Balcão, silent failure)
      if (!isBalcao && effectiveContact && effectiveContact.phone && effectiveContact.phone !== "00000000000") {
        const p = effectiveContact.phone.replace(/\D/g, "")
        const withCC = p.startsWith("55") && p.length >= 12 ? p : `55${p}`
        const jid = `${withCC}@s.whatsapp.net`
        const lines = [
          `✅ *Venda ${data.number} concluída!*`,
          `Total: ${fmtR(total)}`,
          `Pagamento: ${PAY_LABEL[pm] ?? pm}`,
          pm === "prazo" && dd
            ? `Vencimento: ${new Date(dd + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
            : null,
          `Obrigado pela compra! 🧡`,
        ].filter(Boolean).join("\n")
        fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jid, text: lines }),
        }).catch(() => {})
      }

      const receiptContact = effectiveContact
        ? { name: effectiveContact.name, phone: effectiveContact.phone ?? null }
        : newMode && newPhone.trim()
        ? { name: newName.trim() || null, phone: newPhone.trim() }
        : null

      const saleReceipt: SaleReceipt = {
        id:            data.id,
        number:        data.number,
        total,
        paymentMethod: pm,
        dueDate:       pm === "prazo" ? dd : undefined,
        notes:         notes.trim() || undefined,
        contact:       receiptContact,
        items: cartSnapshot.map(i => ({
          key:          i.key,
          productName:  i.productName,
          color:        i.color,
          size:         i.size,
          qty:          i.qty,
          metros:       i.metros,
          precoPorMetro: i.precoPorMetro,
          unitPrice:    effectiveUnitPrice(i),
        })),
      }

      setLastSale({ number: data.number, total })
      setAutoPrint(printAfter)
      setReceipt(saleReceipt)
      setCart([])
      clearContact()
      setNotes("")
      setPayMethod("dinheiro")
      setDueDate("")
      await load()
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : "Erro ao finalizar venda")
    } finally {
      setSaving(false)
    }
  }

  async function finalizeSale(printAfter = false) {
    if (cart.length === 0) return
    if (!hasClientOrBalcao) {
      setSaleError("Selecione um cliente ou Balcão antes de finalizar.")
      return
    }
    if (payMethod === "prazo" && !activeContact) {
      setSaleError("Venda a prazo exige um cliente identificado.")
      return
    }
    // Auto-compute dueDate for clients with fixed payment term
    let effectiveDueDate = dueDate
    if (payMethod === "prazo" && !effectiveDueDate && activeContact?.paymentTermType === "days" && activeContact.paymentTermDays) {
      const [y, mo, day] = todayBR().split("-").map(Number)
      const d = new Date(y, mo - 1, day + Number(activeContact.paymentTermDays))
      effectiveDueDate = dateBR(d)
    }
    if (payMethod === "prazo" && !effectiveDueDate) {
      setSaleError("Informe o vencimento para venda a prazo.")
      return
    }
    await doSale(payMethod, effectiveDueDate, printAfter)
  }

  async function finalizeAsPrazo() {
    if (cart.length === 0) return
    if (!hasClientOrBalcao) {
      setSaleError("Selecione um cliente ou Balcão antes de finalizar.")
      return
    }
    const c = selectedContact ?? duplicateFound
    let dd = ""
    if (c?.paymentTermType === "days" && c.paymentTermDays) {
      const [y, mo, day] = todayBR().split("-").map(Number)
      const d = new Date(y, mo - 1, day + c.paymentTermDays)
      dd = dateBR(d)
    } else if (dueDate) {
      dd = dueDate
    }
    if (!dd) {
      setSaleError("Informe o vencimento para venda a prazo.")
      return
    }
    await doSale("prazo", dd)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex gap-5 items-start">

        {/* ─── Left: product browser ──────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Search bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar produto..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] bg-white"
              />
            </div>
            <button onClick={load} className="p-2.5 rounded-xl bg-white border border-[#0F1E3C]/8 text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Collapsible stock product cards */}
          {!loading && filteredStock.length > 0 && (
            <div className="space-y-3">
              {filteredStock.map(g => {
                const collapsed = !expandedGroups.has(g.productId)
                const colorMap  = new Map<string, Variant[]>()
                for (const v of g.variants) {
                  if (!colorMap.has(v.color)) colorMap.set(v.color, [])
                  colorMap.get(v.color)!.push(v)
                }
                const colorGroups = [...colorMap.entries()].sort(([a], [b]) => a.localeCompare(b))
                colorGroups.forEach(([, variants]) => variants.sort((a, b) => sizeSort(a.size, b.size)))

                return (
                  <div key={g.productId} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
                    <button
                      onClick={() => toggleGroup(g.productId)}
                      className="w-full flex items-center justify-between px-4 py-3 border-b border-[#0F1E3C]/6 bg-[#F9FAFB] hover:bg-[#F0F2F8] transition-colors"
                    >
                      <p className="font-bold text-[#0F1E3C] text-sm text-left">{g.productName}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className="text-sm font-black text-[#4361EE]">{fmtR(g.price)}</p>
                        {collapsed
                          ? <ChevronDown size={14} className="text-[#0F1E3C]/30" />
                          : <ChevronUp   size={14} className="text-[#0F1E3C]/30" />}
                      </div>
                    </button>

                    {!collapsed && (
                      <div className="px-4 py-3 space-y-2.5">
                        {colorGroups.map(([color, variants]) => (
                          <div key={color} className="flex items-center gap-2 flex-wrap">
                            {color && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 w-16 flex-shrink-0 truncate">
                                {color}
                              </span>
                            )}
                            {variants.map(v => {
                              const inCart = cart.find(i => i.key === v.variantId)
                              return (
                                <button
                                  key={v.variantId}
                                  onClick={() => addVariant(v)}
                                  disabled={v.currentStock <= 0}
                                  title={
                                    v.currentStock < 0
                                      ? `Estoque negativo: ${v.currentStock}`
                                      : v.currentStock === 0
                                      ? "Sem estoque"
                                      : `${v.currentStock} em estoque`
                                  }
                                  className={variantBtnClass(v, inCart)}
                                >
                                  <span>{v.size || "U"}</span>
                                  <span className={`text-[9px] font-semibold leading-none mt-0.5 ${variantStockClass(v, inCart)}`}>
                                    {v.currentStock}
                                  </span>
                                  {inCart && (
                                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#4361EE] text-white rounded-full text-[8px] font-black flex items-center justify-center leading-none">
                                      {inCart.qty}
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Non-stock products */}
          {!loading && filteredNonStock.length > 0 && (
            <div className="space-y-2">
              {filteredStock.length > 0 && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 pt-1">Serviços / Outros</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {filteredNonStock.map(p => {
                  const key    = `p-${p.id}`
                  const inCart = cart.find(i => i.key === key)
                  if (p.precoPorMetro) {
                    const mv     = metroValues[key] ?? ""
                    const parsedM = parseFloat(mv.replace(",", "."))
                    const validM  = !isNaN(parsedM) && parsedM > 0
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-col gap-2.5 px-4 py-3 rounded-2xl border transition-all ${
                          inCart ? "border-[#7C3AED] bg-purple-50/60" : "bg-white border-[#0F1E3C]/8"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-[#0F1E3C] truncate flex-1 mr-2">{p.name}</p>
                          <p className="text-xs font-black text-[#7C3AED] flex-shrink-0">{fmtR(p.salePrice ?? 0)}/m</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={mv}
                            onChange={e => setMetroValues(prev => ({ ...prev, [key]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && validM) addMetroProduct(p, parsedM) }}
                            placeholder="Metragem ex: 1.50"
                            className="flex-1 px-2.5 py-2 rounded-xl border border-[#7C3AED]/30 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"
                          />
                          <span className="text-xs text-[#0F1E3C]/40 flex-shrink-0 font-semibold">m</span>
                          <button
                            onClick={() => validM && addMetroProduct(p, parsedM)}
                            disabled={!validM}
                            className="px-3 py-2 rounded-xl bg-[#7C3AED] text-white text-xs font-bold hover:bg-[#6D28D9] transition-colors disabled:opacity-30 flex-shrink-0"
                          >
                            {inCart ? "↺" : "+"}
                          </button>
                        </div>
                        {inCart && (
                          <p className="text-[10px] text-[#7C3AED] font-semibold">
                            No carrinho: {(inCart.metros ?? 0).toFixed(2)} m · {fmtR((inCart.metros ?? 0) * (inCart.unitPrice ?? 0))}
                          </p>
                        )}
                      </div>
                    )
                  }

                  return (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition-all ${
                        inCart
                          ? "border-[#4361EE] bg-[#4361EE]/8"
                          : "bg-white border-[#0F1E3C]/8 hover:border-[#4361EE]/40 hover:bg-[#F9FAFB]"
                      }`}
                    >
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-bold text-[#0F1E3C] truncate">{p.name}</p>
                        <p className="text-xs font-semibold text-[#4361EE] mt-0.5">{fmtR(p.salePrice ?? 0)}</p>
                      </div>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        inCart ? "bg-[#4361EE] text-white" : "bg-[#0F1E3C]/6 text-[#0F1E3C]/40"
                      }`}>
                        {inCart ? <span className="text-xs font-black">{inCart.qty}</span> : <Plus size={14} />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!loading && filteredStock.length === 0 && filteredNonStock.length === 0 && (
            <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
              <Store size={40} strokeWidth={1.2} />
              <p className="text-sm">{search ? "Nenhum produto encontrado." : "Nenhum produto ativo cadastrado."}</p>
            </div>
          )}
        </div>

        {/* ─── Right: Cart ────────────────────────────────────────────── */}
        <div className="w-[340px] flex-shrink-0 sticky top-0 self-start">
          <div
            className="bg-white rounded-2xl border border-[#0F1E3C]/8 flex flex-col overflow-hidden"
            style={{ maxHeight: "calc(100vh - 100px)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={15} className="text-[#0F1E3C]/40" />
                <span className="text-sm font-bold text-[#0F1E3C]">Carrinho</span>
                {cartCount > 0 && (
                  <span className="text-[10px] font-black bg-[#4361EE] text-white px-1.5 py-0.5 rounded-full leading-none">
                    {cartCount}
                  </span>
                )}
              </div>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-xs text-red-400 hover:text-red-600 font-semibold transition-colors">
                  Limpar
                </button>
              )}
            </div>

            {/* Success banner */}
            {lastSale && !receipt && (
              <div className="flex-shrink-0 mx-3 mt-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Check size={13} className="text-emerald-600" />
                    <p className="text-sm font-bold text-emerald-700">Venda concluída!</p>
                  </div>
                  <button onClick={() => setLastSale(null)} className="text-emerald-400 hover:text-emerald-600">
                    <X size={12} />
                  </button>
                </div>
                <p className="text-xs text-emerald-600 mt-0.5">{lastSale.number} · {fmtR(lastSale.total)}</p>
              </div>
            )}

            {/* Items */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#0F1E3C]/20">
                  <ShoppingCart size={28} strokeWidth={1.2} />
                  <p className="text-xs">Adicione produtos ao carrinho</p>
                </div>
              ) : (
                <div className="divide-y divide-[#0F1E3C]/4">
                  {cartGroups.map(group => {
                    const singleItem = group.items[0]
                    const isVariantGroup = !!singleItem.variantId
                    const ep = effectiveUnitPrice(singleItem)
                    const hasAdjust = ep !== group.unitPrice

                    // ── precoPorMetro item ──────────────────────────────────
                    if (singleItem.precoPorMetro) {
                      return (
                        <div key={group.groupKey} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#0F1E3C] truncate">{group.productName}</p>
                            <p className={`text-[10px] font-semibold ${hasAdjust ? "text-amber-600" : "text-[#7C3AED]"}`}>{fmtR(ep)}/m</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input
                              type="number" step="0.01" min="0.01"
                              value={singleItem.metros ?? ""}
                              onChange={e => updateMetros(singleItem.key, parseFloat(e.target.value))}
                              className="w-16 px-2 py-1 rounded-lg border border-[#7C3AED]/30 text-xs text-center font-bold text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#7C3AED]/40"
                            />
                            <span className="text-[10px] text-[#0F1E3C]/40">m</span>
                          </div>
                          <p className="text-sm font-black text-[#0F1E3C] flex-shrink-0 min-w-[56px] text-right">{fmtR((singleItem.metros ?? 0) * ep)}</p>
                          <button onClick={() => setCart(prev => prev.filter(i => i.key !== singleItem.key))} className="text-[#0F1E3C]/20 hover:text-red-400 transition-colors flex-shrink-0"><X size={13} /></button>
                        </div>
                      )
                    }

                    // ── Non-stock single item ───────────────────────────────
                    if (!isVariantGroup) {
                      return (
                        <div key={group.groupKey} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#0F1E3C] truncate">{group.productName}</p>
                            <div className="flex items-center gap-1.5">
                              {hasAdjust && <span className="text-[10px] text-[#0F1E3C]/30 line-through">{fmtR(group.unitPrice)}</span>}
                              <p className={`text-[10px] font-semibold ${hasAdjust ? "text-amber-600" : "text-[#7C3AED]"}`}>{fmtR(ep)}/un</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => updateQty(singleItem.key, -1)} className="w-6 h-6 rounded-lg bg-[#0F1E3C]/6 hover:bg-[#0F1E3C]/12 flex items-center justify-center transition-colors"><Minus size={10} /></button>
                            <input
                              type="number" step="0.01" min="0.01"
                              value={singleItem.qty || ""}
                              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setCart(prev => prev.map(i => i.key === singleItem.key ? { ...i, qty: v } : i)) }}
                              onBlur={e => { if (!e.target.value || parseFloat(e.target.value) <= 0) setCart(prev => prev.filter(i => i.key !== singleItem.key)) }}
                              className="w-10 text-center text-sm font-black text-[#0F1E3C] bg-transparent focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30 rounded"
                            />
                            <button onClick={() => updateQty(singleItem.key, 1)} className="w-6 h-6 rounded-lg bg-[#0F1E3C]/6 hover:bg-[#0F1E3C]/12 flex items-center justify-center transition-colors"><Plus size={10} /></button>
                          </div>
                          <p className="text-sm font-black text-[#0F1E3C] flex-shrink-0 min-w-[56px] text-right">{fmtR(singleItem.qty * ep)}</p>
                          <button onClick={() => setCart(prev => prev.filter(i => i.key !== singleItem.key))} className="text-[#0F1E3C]/20 hover:text-red-400 transition-colors flex-shrink-0"><X size={13} /></button>
                        </div>
                      )
                    }

                    // ── Variant product group ───────────────────────────────
                    return (
                      <div key={group.groupKey}>
                        {/* Product header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-[#F4F6FB]">
                          <p className="text-xs font-black text-[#0F1E3C] truncate flex-1 min-w-0">{group.productName}</p>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {hasAdjust && <span className="text-[10px] text-[#0F1E3C]/30 line-through">{fmtR(group.unitPrice)}</span>}
                            <span className={`text-[10px] font-bold ${hasAdjust ? "text-amber-600" : "text-[#4361EE]"}`}>{fmtR(ep)}/un</span>
                          </div>
                        </div>
                        {/* Variant rows */}
                        {group.items.map(variant => (
                          <div key={variant.key} className="flex items-center gap-2 px-4 py-2 border-t border-[#0F1E3C]/4">
                            <p className="text-[10px] font-semibold text-[#0F1E3C]/50 flex-1 min-w-0 truncate">
                              {[variant.color, variant.size].filter(Boolean).join(" / ")}
                            </p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => updateQty(variant.key, -1)} className="w-5 h-5 rounded bg-[#0F1E3C]/6 hover:bg-[#0F1E3C]/12 flex items-center justify-center transition-colors"><Minus size={9} /></button>
                              <input
                                type="number" min={1} max={variant.maxStock}
                                value={variant.qty}
                                onChange={e => setQtyDirect(variant.key, parseInt(e.target.value))}
                                onBlur={e => { if (!e.target.value || parseInt(e.target.value) < 1) setCart(prev => prev.filter(i => i.key !== variant.key)) }}
                                className="w-9 text-center text-xs font-black text-[#0F1E3C] bg-transparent focus:outline-none"
                              />
                              <button onClick={() => updateQty(variant.key, 1)} disabled={variant.maxStock !== undefined && variant.qty >= variant.maxStock} className="w-5 h-5 rounded bg-[#0F1E3C]/6 hover:bg-[#0F1E3C]/12 flex items-center justify-center transition-colors disabled:opacity-30"><Plus size={9} /></button>
                            </div>
                            <p className="text-sm font-black text-[#0F1E3C] flex-shrink-0 min-w-[52px] text-right">{fmtR(variant.qty * ep)}</p>
                            <button onClick={() => setCart(prev => prev.filter(i => i.key !== variant.key))} className="text-[#0F1E3C]/20 hover:text-red-400 transition-colors flex-shrink-0"><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-[#0F1E3C]/8 p-4 space-y-3">

              {/* ── Cliente ── */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">Cliente</p>

                {/* Balcão chip */}
                {isBalcao ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#F4F6FB]">
                    <div className="flex items-center gap-2">
                      <Store size={13} className="text-[#0F1E3C]/40 flex-shrink-0" />
                      <p className="text-xs font-bold text-[#0F1E3C]">Balcão</p>
                      <span className="text-[9px] text-[#0F1E3C]/35 bg-[#0F1E3C]/8 px-1.5 py-0.5 rounded-full">Sem cliente</span>
                    </div>
                    <button onClick={clearContact} className="text-[#0F1E3C]/25 hover:text-red-400 transition-colors">
                      <X size={13} />
                    </button>
                  </div>

                /* Contact chip */
                ) : activeContact ? (
                  <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${activeContact.precoExclusivo ? "bg-amber-50 border border-amber-200" : "bg-[#F4F6FB]"}`}>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-bold text-[#0F1E3C]">{activeContact.name || "Sem nome"}</p>
                        {activeContact.precoExclusivo && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">★ Preço Esp.</span>
                        )}
                        {activeContact.paymentTermEnabled && (
                          <span className="text-[9px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
                            {activeContact.paymentTermDays ? `Prazo ${activeContact.paymentTermDays}d` : "Prazo"}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[#0F1E3C]/40">{fmtPhone(activeContact.phone)}</p>
                    </div>
                    <button onClick={clearContact} className="text-[#0F1E3C]/25 hover:text-red-400 transition-colors flex-shrink-0">
                      <X size={13} />
                    </button>
                  </div>

                /* New contact form */
                ) : newMode ? (
                  <div className="space-y-1.5">
                    <input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="Nome (opcional)"
                      className="w-full px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                    />
                    <div className="flex gap-1.5">
                      <input
                        value={newPhone}
                        onChange={e => { setNewPhone(e.target.value); setDuplicateFound(null) }}
                        onBlur={handlePhoneBlur}
                        placeholder="Telefone *"
                        className="flex-1 px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                      />
                      <button onClick={clearContact} className="px-2.5 rounded-xl border border-[#0F1E3C]/12 text-[#0F1E3C]/30 hover:text-red-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                    {duplicateFound && (
                      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                        <p className="text-[10px] text-amber-800 flex-1 min-w-0 truncate">
                          Já cadastrado: <strong>{duplicateFound.name || "Sem nome"}</strong>
                        </p>
                        <button
                          onClick={() => pickContactWithClear(duplicateFound)}
                          className="text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-lg transition-colors flex-shrink-0 ml-2"
                        >
                          Usar
                        </button>
                      </div>
                    )}
                  </div>

                /* Search dropdown */
                ) : (
                  <div className="relative" ref={dropRef}>
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 pointer-events-none" />
                      <input
                        value={contactSearch}
                        onChange={e => { setContactSearch(e.target.value); setShowDrop(true) }}
                        onFocus={() => setShowDrop(true)}
                        placeholder="Buscar cliente..."
                        className="w-full pl-7 pr-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                      />
                    </div>
                    {/* Quick Balcão button below search */}
                    {!showDrop && (
                      <button
                        onClick={selectBalcao}
                        className="mt-1 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-[#0F1E3C]/15 text-[10px] font-semibold text-[#0F1E3C]/40 hover:text-[#0F1E3C]/70 hover:border-[#0F1E3C]/30 transition-colors"
                      >
                        <Store size={11} /> Venda Balcão (sem cliente)
                      </button>
                    )}
                    {showDrop && (
                      <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-[#0F1E3C]/10 rounded-xl shadow-lg z-20 overflow-hidden max-h-48 overflow-y-auto">
                        {contactSuggestions.map(c => (
                          <button key={c.id} onClick={() => pickContactWithClear(c)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F4F6FB] text-left transition-colors">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-[#0F1E3C] truncate">{c.name || "Sem nome"}</p>
                              <p className="text-[10px] text-[#0F1E3C]/40">{fmtPhone(c.phone)}</p>
                            </div>
                          </button>
                        ))}
                        <div className="flex border-t border-[#0F1E3C]/6">
                          <button
                            onClick={() => { setNewMode(true); setShowDrop(false); setContactSearch("") }}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-[#4361EE] hover:bg-[#F4F6FB] transition-colors border-r border-[#0F1E3C]/6"
                          >
                            <UserPlus size={12} /> Cadastrar novo
                          </button>
                          <button
                            onClick={selectBalcao}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-[#0F1E3C]/50 hover:bg-[#F4F6FB] transition-colors"
                          >
                            <Store size={12} /> Balcão
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Skeleton Preço Exclusivo ── always visible */}
              {activeContact?.precoExclusivo && cart.length > 0 ? (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">★ Preço Exclusivo</p>
                    <div className="flex rounded-lg border border-amber-200 overflow-hidden text-[10px] font-bold">
                      <button
                        onClick={() => { setExclusivoMode("item"); setDescontoValor("") }}
                        className={`px-2.5 py-1 transition-colors ${exclusivoMode === "item" ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-100"}`}
                      >Por item</button>
                      <button
                        onClick={() => { setExclusivoMode("desconto"); setPriceOverrides({}) }}
                        className={`px-2.5 py-1 transition-colors ${exclusivoMode === "desconto" ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-100"}`}
                      >Desconto</button>
                    </div>
                  </div>

                  {exclusivoMode === "item" ? (
                    <div className="space-y-1.5">
                      {cartGroups.map(group => (
                        <div key={group.groupKey} className="flex items-center gap-2">
                          <span className="text-[10px] text-amber-800 flex-1 min-w-0 truncate">
                            {group.productName}
                            {group.items.length > 1 && <span className="text-amber-500 ml-1">({group.items.length} var.)</span>}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-[9px] text-amber-500 font-semibold">R$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={priceOverrides[group.groupKey] ?? ""}
                              placeholder={Number(group.unitPrice).toFixed(2)}
                              onChange={e => setPriceOverrides(prev => ({ ...prev, [group.groupKey]: e.target.value }))}
                              className="w-20 px-2 py-1 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-400 text-right"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-lg border border-amber-200 overflow-hidden text-[10px] font-bold flex-shrink-0">
                          <button
                            onClick={() => setDescontoTipo("percent")}
                            className={`px-2.5 py-1.5 transition-colors ${descontoTipo === "percent" ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-100"}`}
                          >%</button>
                          <button
                            onClick={() => setDescontoTipo("reais")}
                            className={`px-2.5 py-1.5 transition-colors ${descontoTipo === "reais" ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-100"}`}
                          >R$</button>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={descontoValor}
                          placeholder={descontoTipo === "percent" ? "0" : "0,00"}
                          onChange={e => setDescontoValor(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-sm font-bold text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex items-center justify-between text-[10px] font-semibold text-amber-700 border-t border-amber-200 pt-1.5">
                          <span>Desconto aplicado</span>
                          <span>-{fmtR(discountAmount)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Skeleton inativo */
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F4F6FB] border border-[#0F1E3C]/6">
                  <span className="text-[10px] text-[#0F1E3C]/30 font-semibold">★ Preço Exclusivo</span>
                  <span className="text-[9px] text-[#0F1E3C]/20">
                    {!activeContact
                      ? "— selecione um cliente"
                      : !activeContact.precoExclusivo
                      ? "— sem permissão"
                      : "— adicione itens"}
                  </span>
                </div>
              )}

              {/* ── Pagamento ── */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">Pagamento</p>
                <div className="flex flex-wrap gap-1.5">
                  {PAY_OPTIONS.map(opt => {
                    const isPrazo = opt.value === "prazo"
                    const prazoNoClient = isPrazo && !activeContact
                    const prazoNoPermission = isPrazo && !!activeContact && !activeContact.paymentTermEnabled
                    const prazoDisabled = prazoNoClient || prazoNoPermission
                    const prazoTitle = prazoNoClient
                      ? "Selecione um cliente para habilitar prazo"
                      : prazoNoPermission
                      ? "Cliente sem permissão de prazo"
                      : undefined
                    return (
                      <button
                        key={opt.value}
                        onClick={() => { if (!prazoDisabled) setPayMethod(opt.value) }}
                        disabled={prazoDisabled}
                        title={prazoTitle}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          prazoDisabled
                            ? "bg-[#F4F6FB] text-[#0F1E3C]/20 cursor-not-allowed"
                            : payMethod === opt.value
                            ? opt.value === "prazo"
                              ? "bg-amber-500 text-white"
                              : "bg-[#0F1E3C] text-white"
                            : "bg-[#F4F6FB] text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Due date for prazo */}
              {payMethod === "prazo" && (() => {
                const isAutoDays =
                  activeContact?.paymentTermEnabled &&
                  activeContact?.paymentTermType === "days" &&
                  !!dueDate
                return (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">
                      Vencimento {!isAutoDays && <span className="text-red-400">*</span>}
                    </p>
                    {isAutoDays ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#F4F6FB] rounded-xl">
                        <span className="text-xs font-semibold text-[#0F1E3C]">
                          {new Date(dueDate + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </span>
                        <span className="text-[10px] text-[#0F1E3C]/40">
                          ({activeContact!.paymentTermDays}d corridos)
                        </span>
                      </div>
                    ) : (
                      <input
                        type="date"
                        value={dueDate}
                        min={todayISO()}
                        onChange={e => setDueDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                      />
                    )}
                  </div>
                )
              })()}

              {/* Notes */}
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Observação (opcional)"
                className="w-full px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
              />

              {/* Aviso: sem cliente/balcão selecionado */}
              {!hasClientOrBalcao && cart.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                  <span className="text-[11px] text-amber-700 font-semibold">Selecione um cliente ou Balcão para finalizar</span>
                </div>
              )}

              {saleError && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{saleError}</p>
              )}

              {/* ── Total + botões de finalizar ── */}
              <div className="space-y-2 pt-1">
                {activeContact?.precoExclusivo && exclusivoMode === "desconto" && discountAmount > 0 ? (

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[#0F1E3C]/40">Subtotal</span>
                      <span className="text-sm text-[#0F1E3C]/30 line-through">{fmtR(baseTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-[#0F1E3C]/6 pt-1">
                      <span className="text-xs text-[#0F1E3C]/40">{cartCount} {cartCount === 1 ? "item" : "itens"}</span>
                      <span className="text-2xl font-black text-[#0F1E3C]">{fmtR(total)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#0F1E3C]/40">{cartCount} {cartCount === 1 ? "item" : "itens"}</span>
                    <span className="text-2xl font-black text-[#0F1E3C]">{fmtR(total)}</span>
                  </div>
                )}

                {/* Dois botões: Finalizar | Imprimir */}
                <div className="flex gap-2">
                  <button
                    onClick={() => finalizeSale(false)}
                    disabled={cart.length === 0 || saving || !hasClientOrBalcao}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-black rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Receipt size={15} />}
                    {saving ? "Finalizando..." : "Finalizar Venda"}
                  </button>
                  <button
                    onClick={() => finalizeSale(true)}
                    disabled={cart.length === 0 || saving || !hasClientOrBalcao}
                    title="Finalizar e imprimir comprovante"
                    className="flex items-center justify-center px-4 py-3 bg-[#0F1E3C]/8 hover:bg-[#0F1E3C]/15 text-[#0F1E3C] rounded-xl disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    <Printer size={15} />
                  </button>
                </div>

                {/* Finalizar a Prazo (quando cliente com permissão) */}
                {activeContact?.paymentTermEnabled && (
                  <button
                    onClick={finalizeAsPrazo}
                    disabled={cart.length === 0 || saving}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-black rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Receipt size={15} />}
                    {saving ? "Finalizando..." : activeContact.paymentTermDays
                      ? `Finalizar a Prazo · ${activeContact.paymentTermDays}d`
                      : "Finalizar a Prazo"}
                  </button>
                )}
              </div>
            </div>

            {/* ── Últimos pedidos ── */}
            {recentOrders.length > 0 && (
              <div className="flex-shrink-0 border-t border-[#0F1E3C]/8 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Últimos pedidos</p>
                  <a href="/dashboard/relatorio-vendas" className="text-[10px] font-semibold text-[#4361EE] hover:underline">Ver mais</a>
                </div>
                <div className="space-y-1">
                  {recentOrders.map(order => (
                    <div key={order.id} className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-[#0F1E3C]/60 flex-shrink-0">{order.number}</span>
                      <span className="text-[10px] text-[#0F1E3C]/40 truncate">{order.contactName ?? "Balcão"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && (
        <PdvReceiptModal
          receipt={receipt}
          autoPrint={autoPrint}
          onClose={() => { setReceipt(null); setLastSale(null); setAutoPrint(false) }}
        />
      )}
    </>
  )
}
