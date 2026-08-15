"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Printer, Trash2, Loader2, CheckCircle2, PackageSearch, History, Ban, Pencil, Check, X, Tag, ShoppingCart, Layers } from "lucide-react"
import { fmtDateBR } from "@/lib/tz"
import { colorSwatch } from "@/lib/colorSwatch"
import { sizeCompare } from "@/lib/sizeOrder"
import { printWhenReady } from "@/components/print/print-utils"
import MarketplacePrintSheet from "./MarketplacePrintSheet"
import MarketplaceBlocksPrintSheet from "./MarketplaceBlocksPrintSheet"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}

// "Separar" — só leitura, sem casamento com catálogo. Não agrupa por
// anúncio/título — pra separar estoque físico o print não importa, só cor +
// tamanho + quantidade (kit fica separado de peça avulsa, é pick diferente).
type FlatGroup = { isKit: boolean; tipo: string; cor: string; tamanho: string; qty: number; anuncios: number }
type SourceSummary = { pedidos: number | null; totalItens: number | null } | null

// Prefixo do SKU → tipo de peça (texto livre) — só separa cor+tamanho igual
// que são peças diferentes (moletom vs camiseta), não é matching de produto.
type SkuPrefix = { id: number; prefix: string; tipo: string; createdAt: string }

// Modelo de kit — só guarda quais produtos compõem (ex: Camisetas Infantil +
// Bermuda Infantil Moletinho). Cor/tamanho são resolvidos contra o catálogo
// de verdade na hora de montar o carrinho, nunca fixados aqui.
type KitTemplateItem = { templateId: number; productId: string; productName: string }
type KitTemplate = { id: number; nome: string; createdAt: string; items: KitTemplateItem[] }

// "Lançar manual" — cada linha já é uma escolha real de produto/cor/tamanho,
// vira baixa de estoque de verdade ao confirmar.
type ManualRow = {
  id: string; variantId: string; productName: string; color: string; size: string
  sku: string; stock: number; qty: number
  kitGroupId?: string // peças que vieram do mesmo clique em "Adicionar kit" — editam quantidade juntas
}

type HistoryRow = {
  id: number; number: string; origin: string; totalItems: number; totalPieces: number
  createdAt: string; canceledAt: string | null
}
type SeparationDetailItem = { id: number; variantId: string; productName: string; color: string; size: string; sku: string; qty: number }
type SeparationDetail = HistoryRow & { items: SeparationDetailItem[] }

type Origin = "shopee" | "mercado_livre" | "manual"
const ORIGIN_LABEL: Record<Origin, string> = { shopee: "Shopee", mercado_livre: "Mercado Livre", manual: "Manual" }

let rowSeq = 0
const newRowId = () => `row-${Date.now()}-${rowSeq++}`

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [tab, setTab] = useState<"separar" | "relatorio">("separar")
  const [origin, setOrigin] = useState<Origin>("shopee")

  const [catalog, setCatalog] = useState<CatalogVariant[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const res = await fetch("/api/stock/balance")
      if (res.ok) setCatalog(await res.json())
    } finally { setCatalogLoading(false) }
  }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])
  const productNames = useMemo(() => [...new Set(catalog.map(c => c.productName))].sort(), [catalog])
  const productList = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of catalog) map.set(c.productId, c.productName)
    return [...map.entries()].map(([productId, productName]) => ({ productId, productName })).sort((a, b) => a.productName.localeCompare(b.productName))
  }, [catalog])

  // ── "Ler picklist" — extração + agrupamento, sem gravar nada ──
  const [processing, setProcessing] = useState(false)
  const [processMsg, setProcessMsg] = useState("")
  const [uploadError, setUploadError] = useState("")
  const [pastedText, setPastedText] = useState("")
  const [showPaste, setShowPaste] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const [groups, setGroups] = useState<FlatGroup[] | null>(null)
  const [sourceSummary, setSourceSummary] = useState<SourceSummary>(null)
  const [readFilename, setReadFilename] = useState("")
  const [showBlocksPrint, setShowBlocksPrint] = useState(false)
  // Marcar "já separei essa" — só visual, ajuda a não se perder na lista
  // enquanto monta o carrinho ao lado. Não é salvo, zera numa leitura nova.
  const [checkedGroups, setCheckedGroups] = useState<Set<string>>(new Set())
  function toggleChecked(key: string) {
    setCheckedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // ── Prefixos de SKU (tipo de peça) ──
  const [prefixOpen, setPrefixOpen] = useState(false)
  const [prefixes, setPrefixes] = useState<SkuPrefix[]>([])
  const [prefixLoading, setPrefixLoading] = useState(false)
  const [newPrefix, setNewPrefix] = useState("")
  const [newTipo, setNewTipo] = useState("")

  async function loadPrefixes() {
    setPrefixLoading(true)
    try {
      const res = await fetch("/api/marketplace/prefixes")
      if (res.ok) setPrefixes(await res.json())
    } finally { setPrefixLoading(false) }
  }
  function openPrefixModal() { setPrefixOpen(true); loadPrefixes() }
  async function addPrefix() {
    if (!newPrefix.trim() || !newTipo.trim()) return
    const res = await fetch("/api/marketplace/prefixes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: newPrefix, tipo: newTipo }),
    })
    if (res.ok) { setNewPrefix(""); setNewTipo(""); loadPrefixes() }
  }
  async function deletePrefix(id: number) {
    setPrefixes(prev => prev.filter(p => p.id !== id))
    await fetch(`/api/marketplace/prefixes/${id}`, { method: "DELETE" })
  }

  // ── Modelos de kit (nome + produtos que compõem) ──
  const [kitTemplateOpen, setKitTemplateOpen] = useState(false)
  const [kitTemplates, setKitTemplates] = useState<KitTemplate[]>([])
  const [kitTemplateLoading, setKitTemplateLoading] = useState(false)
  const [newKitNome, setNewKitNome] = useState("")
  const [newKitProductIds, setNewKitProductIds] = useState<Set<string>>(new Set())

  async function loadKitTemplates() {
    setKitTemplateLoading(true)
    try {
      const res = await fetch("/api/marketplace/kit-templates")
      if (res.ok) setKitTemplates(await res.json())
    } finally { setKitTemplateLoading(false) }
  }
  useEffect(() => { loadKitTemplates() }, [])
  function openKitTemplateModal() { setKitTemplateOpen(true); loadKitTemplates() }
  function toggleNewKitProduct(productId: string) {
    setNewKitProductIds(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId); else next.add(productId)
      return next
    })
  }
  async function addKitTemplate() {
    if (!newKitNome.trim() || newKitProductIds.size < 2) return
    const res = await fetch("/api/marketplace/kit-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: newKitNome, productIds: [...newKitProductIds] }),
    })
    if (res.ok) { setNewKitNome(""); setNewKitProductIds(new Set()); loadKitTemplates() }
  }
  async function deleteKitTemplate(id: number) {
    setKitTemplates(prev => prev.filter(t => t.id !== id))
    await fetch(`/api/marketplace/kit-templates/${id}`, { method: "DELETE" })
  }

  async function runParse(payload: FormData) {
    setProcessing(true); setUploadError(""); setProcessMsg("Lendo o arquivo…")
    try {
      const res = await fetch("/api/marketplace/parse", { method: "POST", body: payload })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? "Erro ao analisar"); return }
      setGroups(data.groups); setSourceSummary(data.sourceSummary ?? null); setReadFilename(data.filename ?? ""); setCheckedGroups(new Set())
    } catch {
      setUploadError("Falha de rede ao enviar o arquivo")
    } finally {
      setProcessing(false); setProcessMsg("")
    }
  }
  function handleFile(file: File) {
    const form = new FormData()
    form.append("file", file)
    runParse(form)
  }
  function handlePasteSubmit() {
    if (!pastedText.trim()) return
    const form = new FormData()
    form.append("text", pastedText)
    runParse(form)
  }
  function resetRead() {
    setGroups(null); setSourceSummary(null); setReadFilename(""); setUploadError(""); setCheckedGroups(new Set())
    setPastedText(""); setShowPaste(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const groupsTotals = useMemo(() => {
    if (!groups) return { combinacoes: 0, pecas: 0 }
    const combinacoes = groups.length
    const pecas = groups.reduce((s, g) => s + g.qty, 0)
    return { combinacoes, pecas }
  }, [groups])

  // Hoje só existe 1 composição de kit no catálogo (Camiseta Infantil +
  // Bermuda Infantil Moletinho, que só vem em Preto) — nota fixa, não é
  // configurável. Se aparecer outro tipo de kit, isso precisa virar tela.
  function kitNote(g: FlatGroup) {
    if (!g.isKit) return null
    return `= Camiseta Infantil ${g.cor} · ${g.tamanho}  +  Bermuda Preta · ${g.tamanho}`
  }

  // ── Carrinho — cada linha é uma baixa real, confirmar desconta estoque.
  // Clique estilo PDV (produto → cor → tamanho já soma no carrinho, sem
  // formulário) em vez do dropdown+Add de antes. ──────────────────────────
  const [manualRows, setManualRows] = useState<ManualRow[]>([])
  const [cartProductName, setCartProductName] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState("")
  const [result, setResult] = useState<{ number: string; totalItems: number; totalPieces: number; items: { productName: string; color: string; size: string; sku: string; qty: number }[] } | null>(null)
  const [showResultPrint, setShowResultPrint] = useState(false)

  const effCartProduct = productNames.includes(cartProductName) ? cartProductName : (productNames[0] ?? "")
  const cartColorGroups = useMemo(() => {
    const variants = catalog.filter(c => c.productName === effCartProduct)
    const byColor = new Map<string, CatalogVariant[]>()
    for (const v of variants) {
      if (!byColor.has(v.color)) byColor.set(v.color, [])
      byColor.get(v.color)!.push(v)
    }
    const groupsArr = [...byColor.entries()].sort(([a], [b]) => a.localeCompare(b))
    groupsArr.forEach(([, vs]) => vs.sort((a, b) => sizeCompare(a.size, b.size)))
    return groupsArr
  }, [catalog, effCartProduct])

  // `kitGroupId` mantém peça avulsa (sem grupo) e peça de kit sempre em linhas
  // separadas, mesmo que seja a mesma variante — clicar de novo no mesmo kit
  // soma na linha do grupo certo, não mistura com uma peça solta igual.
  function addToCart(variant: CatalogVariant, kitGroupId?: string) {
    setManualRows(prev => {
      const existing = prev.find(r => r.variantId === variant.variantId && r.kitGroupId === kitGroupId)
      if (existing) return prev.map(r => r === existing ? { ...r, qty: r.qty + 1 } : r)
      return [...prev, {
        id: newRowId(), variantId: variant.variantId, productName: variant.productName,
        color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock, qty: 1, kitGroupId,
      }]
    })
  }
  function cartQtyFor(variantId: string) {
    return manualRows.find(r => r.variantId === variantId)?.qty ?? 0
  }
  function variantChipCls(v: CatalogVariant): string {
    const base = "relative flex flex-col items-center px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all min-w-[46px]"
    const inCart = cartQtyFor(v.variantId) > 0
    if (v.availableStock < 0) return `${base} border-red-300 bg-red-50 text-red-500`
    if (v.availableStock === 0) return `${base} border-orange-300 bg-orange-50 text-orange-500`
    if (inCart) return `${base} border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]`
    return `${base} border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:bg-[#4361EE]/6`
  }
  // ── Sub-aba "Kit" do carrinho — escolhe modelo + tamanho, cor só aparece
  // pra peça que tem mais de 1 cor no catálogo (a Bermuda, por ex, resolve
  // sozinha porque só existe em Preto). "Adicionar kit" solta cada peça
  // resolvida no carrinho de uma vez, reaproveitando addToCart. ──────────
  const [cartMode, setCartMode] = useState<"peca" | "kit">("peca")
  const [kitTemplateId, setKitTemplateId] = useState<number | null>(null)
  const [kitSize, setKitSize] = useState("")
  const [kitColors, setKitColors] = useState<Record<string, string>>({})

  const selectedKitTemplate = kitTemplates.find(t => t.id === kitTemplateId) ?? kitTemplates[0] ?? null

  const kitSizeOptions = useMemo(() => {
    if (!selectedKitTemplate) return []
    const sizeSets = selectedKitTemplate.items.map(it => new Set(catalog.filter(c => c.productId === it.productId).map(c => c.size)))
    if (sizeSets.length === 0) return []
    const [first, ...rest] = sizeSets
    return [...first].filter(s => rest.every(set => set.has(s))).sort(sizeCompare)
  }, [selectedKitTemplate, catalog])
  const effKitSize = kitSizeOptions.includes(kitSize) ? kitSize : (kitSizeOptions[0] ?? "")

  const kitComponents = useMemo(() => {
    if (!selectedKitTemplate || !effKitSize) return []
    return selectedKitTemplate.items.map(it => {
      const variants = catalog.filter(c => c.productId === it.productId && c.size === effKitSize)
      const colors = [...new Set(variants.map(v => v.color))]
      const resolvedColor = colors.length === 1 ? colors[0] : (kitColors[it.productId] ?? null)
      const variant = resolvedColor ? variants.find(v => v.color === resolvedColor) ?? null : null
      return { productId: it.productId, productName: it.productName, colors, resolvedColor, variant }
    })
  }, [selectedKitTemplate, effKitSize, catalog, kitColors])

  const kitReady = kitComponents.length > 0 && kitComponents.every(c => c.variant != null)

  function setKitColor(productId: string, color: string) {
    setKitColors(prev => ({ ...prev, [productId]: color }))
  }
  function addKitToCart() {
    if (!kitReady || !selectedKitTemplate) return
    // Determinístico (template+tamanho+cores), não aleatório — clicar de novo
    // no mesmo kit incrementa o grupo já existente em vez de duplicar linha.
    const groupId = `kit-${selectedKitTemplate.id}-${effKitSize}-${kitComponents.map(c => c.resolvedColor).join("-")}`
    for (const c of kitComponents) if (c.variant) addToCart(c.variant, groupId)
  }

  function updateManualQty(id: string, qty: number) {
    setManualRows(prev => prev.map(r => r.id === id ? { ...r, qty: Math.max(1, qty || 1) } : r))
  }
  function removeManualRow(id: string) {
    setManualRows(prev => prev.filter(r => r.id !== id))
  }
  // Peças do mesmo grupo de kit editam quantidade juntas — sempre a mesma
  // proporção (1 camiseta pra 1 bermuda), então 1 número só controla as duas.
  function updateKitGroupQty(groupId: string, qty: number) {
    const q = Math.max(1, qty || 1)
    setManualRows(prev => prev.map(r => r.kitGroupId === groupId ? { ...r, qty: q } : r))
  }
  function removeKitGroup(groupId: string) {
    setManualRows(prev => prev.filter(r => r.kitGroupId !== groupId))
  }
  const cartGroups = useMemo(() => {
    const byKit = new Map<string, ManualRow[]>()
    const solo: ManualRow[] = []
    for (const r of manualRows) {
      if (r.kitGroupId) {
        if (!byKit.has(r.kitGroupId)) byKit.set(r.kitGroupId, [])
        byKit.get(r.kitGroupId)!.push(r)
      } else solo.push(r)
    }
    return { kitGroups: [...byKit.entries()], solo }
  }, [manualRows])

  const manualTotals = useMemo(() => ({
    produtos: manualRows.length,
    pecas: manualRows.reduce((s, r) => s + r.qty, 0),
  }), [manualRows])

  async function confirmSeparation() {
    if (manualRows.length === 0) return
    setConfirming(true); setConfirmError("")
    try {
      const res = await fetch("/api/marketplace/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, rows: manualRows.map(r => ({ variantId: r.variantId, qty: r.qty })) }),
      })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.error ?? "Erro ao confirmar"); return }
      setResult(data)
      setManualRows([])
      loadHistory()
      loadCatalog()
    } catch {
      setConfirmError("Falha de rede ao confirmar")
    } finally {
      setConfirming(false)
    }
  }
  function resetResult() {
    setResult(null); setConfirmError("")
  }

  // ── Relatório de baixas ──
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/marketplace/history")
      if (res.ok) setHistory(await res.json())
    } finally { setHistoryLoading(false) }
  }, [])
  useEffect(() => { if (tab === "relatorio") loadHistory() }, [tab, loadHistory])

  const [detail, setDetail] = useState<SeparationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [canceling, setCanceling] = useState(false)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editingQty, setEditingQty] = useState(1)
  const [savingQty, setSavingQty] = useState(false)
  const [showDetailPrint, setShowDetailPrint] = useState(false)

  async function openDetail(id: number) {
    setDetail(null); setDetailError(""); setDetailLoading(true)
    try {
      const res = await fetch(`/api/marketplace/separations/${id}`)
      const data = await res.json()
      if (!res.ok) { setDetailError(data.error ?? "Erro ao carregar"); return }
      setDetail(data)
    } catch {
      setDetailError("Falha de rede")
    } finally {
      setDetailLoading(false)
    }
  }
  function closeDetail() {
    setDetail(null); setDetailError(""); setEditingItemId(null)
  }
  async function cancelDetail() {
    if (!detail) return
    setCanceling(true)
    try {
      const res = await fetch(`/api/marketplace/separations/${detail.id}/cancel`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setDetailError(data.error ?? "Erro ao cancelar"); return }
      await openDetail(detail.id)
      loadHistory(); loadCatalog()
    } finally {
      setCanceling(false)
    }
  }
  function startEditQty(item: SeparationDetailItem) {
    setEditingItemId(item.id); setEditingQty(item.qty)
  }
  async function saveEditQty(itemId: number) {
    if (!detail || editingQty <= 0) return
    setSavingQty(true)
    try {
      const res = await fetch(`/api/marketplace/separations/${detail.id}/items/${itemId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qty: editingQty }),
      })
      const data = await res.json()
      if (!res.ok) { setDetailError(data.error ?? "Erro ao salvar"); return }
      setEditingItemId(null)
      await openDetail(detail.id)
      loadHistory(); loadCatalog()
    } finally {
      setSavingQty(false)
    }
  }

  return (
    <div className="max-w-6xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Separação · Marketplace</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
          Lê o picklist e organiza por cor e tamanho na referência. Monta o carrinho ao lado pra descontar o estoque de verdade.
        </p>
      </div>

      {/* Tabs principais */}
      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold bg-white w-fit shadow-sm">
        <button onClick={() => setTab("separar")}
          className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${tab === "separar" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
          <PackageSearch size={14} /> Separar
        </button>
        <button onClick={() => setTab("relatorio")}
          className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${tab === "relatorio" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
          <History size={14} /> Relatório de baixas
        </button>
      </div>

      {tab === "separar" && (
        <div className="grid gap-5 md:grid-cols-2 items-start">

          {/* ── Coluna esquerda: referência (leitura, sem estoque) ── */}
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[#0F1E3C] flex items-center gap-1.5"><PackageSearch size={15} className="text-[#4361EE]" /> Referência</h2>
                <button onClick={openPrefixModal} className="flex items-center gap-1.5 text-[11px] font-bold text-[#0F1E3C]/45 hover:text-[#4361EE] border border-[#0F1E3C]/10 hover:border-[#4361EE]/30 rounded-lg px-2.5 py-1.5 transition-colors">
                  <Tag size={12} /> Prefixos de SKU
                </button>
              </div>

              {!groups ? (
                <div>
                  {!processing ? (
                    <>
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
                        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-[#4361EE] bg-[#4361EE]/5" : "border-[#0F1E3C]/12 hover:border-[#4361EE]/50"}`}
                      >
                        <div className="w-11 h-11 rounded-full bg-[#0F1E3C]/5 flex items-center justify-center mx-auto mb-2.5">
                          <PackageSearch size={20} className="text-[#4361EE]" />
                        </div>
                        <p className="font-bold text-sm text-[#0F1E3C]">Arraste o picklist aqui</p>
                        <p className="text-xs text-[#0F1E3C]/40 mt-0.5">ou clique pra escolher o arquivo</p>
                        <p className="text-[11px] text-[#0F1E3C]/30 mt-2">CSV, TXT ou PDF exportado do Shopee/Mercado Livre</p>
                      </div>
                      <input ref={fileInputRef} type="file" accept=".csv,.txt,.pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

                      <div className="text-center mt-3">
                        <button onClick={() => setShowPaste(v => !v)} className="text-xs font-bold text-[#4361EE] underline">
                          {showPaste ? "Fechar" : "Não tenho um arquivo: colar o texto"}
                        </button>
                      </div>
                      {showPaste && (
                        <div className="mt-3 space-y-2">
                          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={5}
                            placeholder="Cola aqui as linhas do picklist (SKU, título, quantidade)…"
                            className={inputCls} />
                          <button onClick={handlePasteSubmit} disabled={!pastedText.trim()} className="w-full py-2.5 rounded-xl bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold">Analisar texto</button>
                        </div>
                      )}
                      {uploadError && <p className="text-xs text-red-600 mt-3 text-center">{uploadError}</p>}
                    </>
                  ) : (
                    <div className="py-12 flex flex-col items-center gap-3">
                      <Loader2 size={24} className="animate-spin text-[#4361EE]" />
                      <p className="text-sm font-semibold text-[#0F1E3C]">{processMsg || "Processando…"}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      {sourceSummary && (sourceSummary.pedidos != null || sourceSummary.totalItens != null) && (
                        <p className="text-[11px] text-[#0F1E3C]/35">
                          O arquivo diz:{sourceSummary.pedidos != null ? ` ${sourceSummary.pedidos} pedidos` : ""}{sourceSummary.totalItens != null ? `, ${sourceSummary.totalItens} itens no total` : ""}
                        </p>
                      )}
                      <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{groupsTotals.combinacoes} itens pra localizar · {groupsTotals.pecas} peças no total</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setShowBlocksPrint(true); printWhenReady() }} className="flex items-center gap-1.5 bg-[#4361EE] text-white text-xs font-bold px-3 py-2 rounded-xl">
                        <Printer size={13} /> Imprimir
                      </button>
                      <button onClick={resetRead} className="text-xs font-bold text-[#0F1E3C]/40 hover:text-[#0F1E3C]">Nova leitura</button>
                    </div>
                  </div>

                  {(["kit", "avulso"] as const).map(section => {
                    const items = groups.filter(g => (section === "kit") === g.isKit)
                    if (items.length === 0) return null
                    return (
                      <div key={section} className="mb-3">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">{section === "kit" ? "Kits" : "Peças avulsas"}</p>
                        <div className="space-y-1">
                          {items.map((g, i) => {
                            const key = `${g.isKit}|${g.tipo}|${g.cor}|${g.tamanho}|${i}`
                            const done = checkedGroups.has(key)
                            return (
                              <div key={key} className={`rounded-lg px-3 py-2 text-xs transition-colors ${done ? "bg-transparent" : "bg-[#F9FAFB]"}`}>
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                  <input type="checkbox" checked={done} onChange={() => toggleChecked(key)}
                                    className="w-3.5 h-3.5 rounded accent-[#4361EE] flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className={`font-semibold ${done ? "text-[#0F1E3C]/30 line-through" : "text-[#0F1E3C]"}`}>
                                        {g.tipo ? `${g.tipo} · ` : ""}{g.cor || "—"}{g.tamanho ? ` · ${g.tamanho}` : ""}
                                      </span>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {g.anuncios > 1 && <span className="text-[10px] text-[#0F1E3C]/35">{g.anuncios} anúncios</span>}
                                        <span className={`font-bold tabular-nums ${done ? "text-[#0F1E3C]/30" : "text-[#0F1E3C]"}`}>× {g.qty}</span>
                                      </div>
                                    </div>
                                    {kitNote(g) && !done && <p className="text-[10px] text-[#4361EE]/70 mt-0.5">{kitNote(g)}</p>}
                                  </div>
                                </label>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Coluna direita: carrinho, igual o PDV — vira baixa real de estoque ── */}
          <div className="md:sticky md:top-4">
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-[#0F1E3C] flex items-center gap-1.5"><ShoppingCart size={15} className="text-[#4361EE]" /> Carrinho</h2>
                  {!result && (
                    <select value={origin} onChange={e => setOrigin(e.target.value as Origin)} className={`${inputCls} !w-auto text-xs font-semibold`}>
                      {(Object.keys(ORIGIN_LABEL) as Origin[]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
                    </select>
                  )}
                </div>

                {!result ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex rounded-lg border border-[#0F1E3C]/10 overflow-hidden text-xs font-bold">
                        <button onClick={() => setCartMode("peca")} className={`px-3 py-1.5 transition-colors ${cartMode === "peca" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>Peça a peça</button>
                        <button onClick={() => setCartMode("kit")} className={`px-3 py-1.5 transition-colors ${cartMode === "kit" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>Kit</button>
                      </div>
                      <button onClick={openKitTemplateModal} className="flex items-center gap-1.5 text-[11px] font-bold text-[#0F1E3C]/45 hover:text-[#4361EE] border border-[#0F1E3C]/10 hover:border-[#4361EE]/30 rounded-lg px-2.5 py-1.5 transition-colors">
                        <Layers size={12} /> Modelos de kit
                      </button>
                    </div>

                    {catalogLoading ? (
                      <p className="text-xs text-[#0F1E3C]/40">Carregando catálogo…</p>
                    ) : cartMode === "peca" ? (
                      <>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {productNames.map(n => (
                            <button key={n} type="button" onClick={() => setCartProductName(n)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                n === effCartProduct ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/55 hover:border-[#4361EE]/40"
                              }`}>
                              {n}
                            </button>
                          ))}
                        </div>

                        <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                          {cartColorGroups.map(([color, variants]) => (
                            <div key={color}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="w-2.5 h-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)] flex-shrink-0" style={{ background: colorSwatch(color) }} />
                                <span className="text-[11px] font-bold text-[#0F1E3C]">{color}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {variants.map(v => {
                                  const qtyIn = cartQtyFor(v.variantId)
                                  return (
                                    <button key={v.variantId} type="button" onClick={() => addToCart(v)} className={variantChipCls(v)}
                                      title={v.availableStock < 0 ? `Estoque negativo: ${v.availableStock}` : v.availableStock === 0 ? "Sem estoque" : `${v.availableStock} em estoque`}>
                                      <span>{v.size || "U"}</span>
                                      {qtyIn > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#4361EE] text-white rounded-full text-[8px] font-black flex items-center justify-center leading-none">
                                          {qtyIn}
                                        </span>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : kitTemplates.length === 0 ? (
                      <p className="text-xs text-[#0F1E3C]/40 py-3">Nenhum modelo de kit cadastrado ainda. Clica em "Modelos de kit" pra criar um.</p>
                    ) : (
                      <div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {kitTemplates.map(t => (
                            <button key={t.id} type="button" onClick={() => { setKitTemplateId(t.id); setKitColors({}) }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                t.id === (selectedKitTemplate?.id ?? -1) ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/55 hover:border-[#4361EE]/40"
                              }`}>
                              {t.nome}
                            </button>
                          ))}
                        </div>

                        {selectedKitTemplate && (
                          <>
                            {kitSizeOptions.length === 0 ? (
                              <p className="text-xs text-red-500 py-2">Esse kit não tem nenhum tamanho em comum entre as peças no catálogo.</p>
                            ) : (
                              <>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">Tamanho</p>
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                  {kitSizeOptions.map(s => (
                                    <button key={s} type="button" onClick={() => { setKitSize(s); setKitColors({}) }}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                        s === effKitSize ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/55 hover:border-[#4361EE]/40"
                                      }`}>
                                      {s}
                                    </button>
                                  ))}
                                </div>

                                <div className="space-y-3">
                                  {kitComponents.map(c => (
                                    <div key={c.productId}>
                                      <p className="text-[11px] font-bold text-[#0F1E3C] mb-1">{c.productName}</p>
                                      {c.colors.length <= 1 ? (
                                        <p className="text-[11px] text-[#0F1E3C]/40">automático: {c.colors[0] ?? "sem estoque nesse tamanho"}</p>
                                      ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                          {c.colors.map(color => (
                                            <button key={color} type="button" onClick={() => setKitColor(c.productId, color)}
                                              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                                                color === c.resolvedColor ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:border-[#4361EE]/40"
                                              }`}>
                                              <span className="w-2.5 h-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)] flex-shrink-0" style={{ background: colorSwatch(color) }} />
                                              {color}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>

                                <button onClick={addKitToCart} disabled={!kitReady}
                                  className="w-full mt-3 py-2 rounded-xl bg-[#4361EE] disabled:opacity-40 text-white text-xs font-bold">
                                  Adicionar kit ao carrinho
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {manualRows.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-dashed border-[#0F1E3C]/10 space-y-1.5 max-h-[220px] overflow-y-auto">
                        {cartGroups.kitGroups.map(([groupId, rows]) => {
                          const qty = rows[0]?.qty ?? 1
                          return (
                            <div key={groupId} className="bg-[#4361EE]/[0.04] border border-[#4361EE]/15 rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center gap-1 mb-1.5">
                                <Layers size={11} className="text-[#4361EE]" />
                                <span className="text-[9px] font-bold uppercase tracking-wide text-[#4361EE]">Kit</span>
                              </div>
                              <div className="space-y-1 mb-2">
                                {rows.map(r => {
                                  const low = r.stock - qty < 0
                                  return (
                                    <div key={r.id} className="flex items-center gap-2 min-w-0">
                                      <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${low ? "bg-red-500" : "bg-emerald-500"}`} />
                                      <span className="text-[#0F1E3C]/70 truncate">{r.productName} · {r.color} · {r.size}</span>
                                    </div>
                                  )
                                })}
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#0F1E3C]/40">quantos kits</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <input type="number" min={1} value={qty} onChange={e => updateKitGroupQty(groupId, parseInt(e.target.value))}
                                    className="w-14 text-center border border-[#0F1E3C]/12 rounded-lg py-1 text-xs tabular-nums" />
                                  <button onClick={() => removeKitGroup(groupId)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {cartGroups.solo.map(r => {
                          const after = r.stock - r.qty
                          const low = after < 0
                          return (
                            <div key={r.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${low ? "bg-red-500" : "bg-emerald-500"}`} title={low ? "Estoque baixo: vai ficar negativo" : "Tem estoque"} />
                                <span className="font-semibold text-[#0F1E3C] truncate">{r.productName} · {r.color} · {r.size}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <input type="number" min={1} value={r.qty} onChange={e => updateManualQty(r.id, parseInt(e.target.value))}
                                  className="w-14 text-center border border-[#0F1E3C]/12 rounded-lg py-1 text-xs tabular-nums" />
                                <button onClick={() => removeManualRow(r.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {confirmError && <p className="text-xs text-red-600 mt-3">{confirmError}</p>}
                  </div>
                ) : (
                  <div>
                    <div className="text-center py-6">
                      <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={26} />
                      </div>
                      <h2 className="text-lg font-bold text-[#0F1E3C]">Separação confirmada</h2>
                      <p className="text-sm text-[#0F1E3C]/45 mt-0.5">{result.number} · Estoque descontado · {result.totalItems} produtos · {result.totalPieces} peças</p>
                    </div>
                    <div className="flex justify-center gap-2 py-2">
                      <button onClick={() => { setShowResultPrint(true); printWhenReady() }} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-sm font-bold px-4 py-2.5 rounded-xl">
                        <Printer size={14} /> Imprimir ficha
                      </button>
                      <button onClick={resetResult} className="bg-[#4361EE] text-white text-sm font-bold px-4 py-2.5 rounded-xl">Nova separação</button>
                    </div>
                  </div>
                )}
              </div>

              {!result && (
                <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-3.5 bg-[#F4F6FB] border-t border-[#0F1E3C]/8">
                  <div className="flex gap-5">
                    <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produtos</p><p className="text-base font-black text-[#0F1E3C] tabular-nums">{manualTotals.produtos}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Peças</p><p className="text-base font-black text-[#0F1E3C] tabular-nums">{manualTotals.pecas} pç</p></div>
                  </div>
                  <button onClick={confirmSeparation} disabled={manualRows.length === 0 || confirming}
                    className="bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5">
                    {confirming && <Loader2 size={14} className="animate-spin" />} Confirmar separação
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "relatorio" && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          {historyLoading ? (
            <p className="text-xs text-[#0F1E3C]/40 px-5 py-6 text-center">Carregando…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-[#0F1E3C]/40 px-5 py-6 text-center">Nenhuma separação registrada ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30 bg-[#F9FAFB]">
                  <th className="text-left px-5 py-2.5">Número</th>
                  <th className="text-left px-5 py-2.5">Data</th>
                  <th className="text-left px-5 py-2.5">Origem</th>
                  <th className="text-left px-5 py-2.5">Produtos</th>
                  <th className="text-left px-5 py-2.5">Peças</th>
                  <th className="text-left px-5 py-2.5">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className={`border-t border-[#0F1E3C]/5 cursor-pointer hover:bg-[#F9FAFB] ${h.canceledAt ? "opacity-50" : ""}`} onClick={() => openDetail(h.id)}>
                    <td className="px-5 py-2.5 font-semibold text-[#0F1E3C]">{h.number}</td>
                    <td className="px-5 py-2.5 text-[#0F1E3C]/50 tabular-nums">{fmtDateBR(h.createdAt)}</td>
                    <td className="px-5 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/50">{ORIGIN_LABEL[h.origin as Origin] ?? h.origin}</span></td>
                    <td className="px-5 py-2.5 tabular-nums">{h.totalItems}</td>
                    <td className="px-5 py-2.5 tabular-nums">{h.totalPieces} pç</td>
                    <td className="px-5 py-2.5">
                      {h.canceledAt
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">cancelada</span>
                        : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">ativa</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-[#0F1E3C]/30">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal de detalhe da separação — cancelar / editar / reimprimir */}
      {(detailLoading || detail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDetail}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div>
                <h2 className="font-bold text-[#0F1E3C]">{detail?.number ?? "Separação"}</h2>
                {detail && (
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {fmtDateBR(detail.createdAt)} · {ORIGIN_LABEL[detail.origin as Origin] ?? detail.origin}
                    {detail.canceledAt && <span className="text-red-500 font-bold"> · Cancelada</span>}
                  </p>
                )}
              </div>
              <button onClick={closeDetail} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {detailLoading && <p className="text-xs text-[#0F1E3C]/40 text-center py-6">Carregando…</p>}
              {detailError && <p className="text-xs text-red-600 text-center py-6">{detailError}</p>}
              {detail && (
                <div className="space-y-1.5">
                  {detail.items.map(it => (
                    <div key={it.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                      <span className="font-semibold text-[#0F1E3C]">{it.productName} · {it.color} · {it.size}</span>
                      {editingItemId === it.id ? (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={1} value={editingQty} onChange={e => setEditingQty(parseInt(e.target.value) || 1)}
                            className="w-14 text-center border border-[#4361EE]/40 rounded-lg py-1 text-xs tabular-nums" autoFocus />
                          <button onClick={() => saveEditQty(it.id)} disabled={savingQty} className="text-emerald-600 hover:text-emerald-700"><Check size={15} /></button>
                          <button onClick={() => setEditingItemId(null)} className="text-[#0F1E3C]/30 hover:text-red-500"><X size={15} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums font-bold text-[#0F1E3C]">{it.qty} pç</span>
                          {!detail.canceledAt && (
                            <button onClick={() => startEditQty(it)} className="text-[#0F1E3C]/30 hover:text-[#4361EE]"><Pencil size={13} /></button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {detail && (
              <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0">
                <button onClick={() => { setShowDetailPrint(true); printWhenReady() }} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-xs font-bold px-3 py-2 rounded-xl">
                  <Printer size={13} /> Reimprimir
                </button>
                {!detail.canceledAt && (
                  <button onClick={cancelDetail} disabled={canceling} className="flex items-center gap-1.5 text-red-500 hover:text-red-600 text-xs font-bold px-3 py-2 rounded-xl border border-red-200">
                    {canceling ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Cancelar e estornar estoque
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de prefixos de SKU — texto livre, só separa tipo de peça na lista */}
      {prefixOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPrefixOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <div>
                <h2 className="font-bold text-[#0F1E3C]">Prefixos de SKU</h2>
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5 max-w-[38ch]">Prefixo do SKU → tipo de peça (texto livre). Só separa itens de cor/tamanho igual mas peça diferente na lista: não mexe em estoque.</p>
              </div>
              <button onClick={() => setPrefixOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              {prefixLoading ? (
                <p className="text-xs text-[#0F1E3C]/40">Carregando…</p>
              ) : prefixes.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/40 text-center py-4">Nenhum prefixo cadastrado ainda.</p>
              ) : (
                <div className="space-y-1 mb-4">
                  {prefixes.map(p => (
                    <div key={p.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                      <span><span className="font-mono font-bold text-[#0F1E3C]">{p.prefix}</span> <span className="text-[#0F1E3C]/40">→</span> <span className="font-semibold text-[#0F1E3C]">{p.tipo}</span></span>
                      <button onClick={() => deletePrefix(p.id)} className="text-[#0F1E3C]/30 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-2 pt-3 border-t border-dashed border-[#0F1E3C]/10" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                <input value={newPrefix} onChange={e => setNewPrefix(e.target.value)} placeholder="Ex: MOL_" className={inputCls} />
                <input value={newTipo} onChange={e => setNewTipo(e.target.value)} placeholder="Ex: Moletom" className={inputCls} />
                <button onClick={addPrefix} className="bg-[#4361EE] text-white text-xs font-bold rounded-xl px-3">+ Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de modelos de kit — nome + produtos que compõem, cor/tamanho vêm do catálogo na hora de usar */}
      {kitTemplateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setKitTemplateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <div>
                <h2 className="font-bold text-[#0F1E3C]">Modelos de kit</h2>
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5 max-w-[38ch]">Nome do kit + quais produtos compõem ele. Cor e tamanho de cada peça vêm do catálogo na hora de montar o carrinho.</p>
              </div>
              <button onClick={() => setKitTemplateOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              {kitTemplateLoading ? (
                <p className="text-xs text-[#0F1E3C]/40">Carregando…</p>
              ) : kitTemplates.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/40 text-center py-4">Nenhum modelo cadastrado ainda.</p>
              ) : (
                <div className="space-y-1.5 mb-4">
                  {kitTemplates.map(t => (
                    <div key={t.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                      <div>
                        <p className="font-bold text-[#0F1E3C]">{t.nome}</p>
                        <p className="text-[#0F1E3C]/45 mt-0.5">{t.items.map(i => i.productName).join(" + ")}</p>
                      </div>
                      <button onClick={() => deleteKitTemplate(t.id)} className="text-[#0F1E3C]/30 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-3 border-t border-dashed border-[#0F1E3C]/10 space-y-2">
                <input value={newKitNome} onChange={e => setNewKitNome(e.target.value)} placeholder="Ex: Kit Infantil" className={inputCls} />
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produtos do kit (marca 2 ou mais)</p>
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {productList.map(p => (
                    <label key={p.productId} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-[#F9FAFB] cursor-pointer">
                      <input type="checkbox" checked={newKitProductIds.has(p.productId)} onChange={() => toggleNewKitProduct(p.productId)}
                        className="w-3.5 h-3.5 rounded accent-[#4361EE]" />
                      <span className="text-[#0F1E3C]">{p.productName}</span>
                    </label>
                  ))}
                </div>
                <button onClick={addKitTemplate} disabled={!newKitNome.trim() || newKitProductIds.size < 2}
                  className="w-full bg-[#4361EE] disabled:opacity-40 text-white text-xs font-bold rounded-xl px-3 py-2">
                  Salvar modelo ({newKitProductIds.size} produto{newKitProductIds.size === 1 ? "" : "s"})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBlocksPrint && groups && (
        <MarketplaceBlocksPrintSheet groups={groups} sourceSummary={sourceSummary} filename={readFilename} onDone={() => setShowBlocksPrint(false)} />
      )}
      {showResultPrint && result && (
        <MarketplacePrintSheet result={result} origin={origin} onDone={() => setShowResultPrint(false)} />
      )}
      {showDetailPrint && detail && (
        <MarketplacePrintSheet
          result={{ number: detail.number, totalItems: detail.totalItems, totalPieces: detail.totalPieces, items: detail.items }}
          origin={detail.origin}
          onDone={() => setShowDetailPrint(false)}
        />
      )}
    </div>
  )
}
