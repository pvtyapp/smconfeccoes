"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Printer, Trash2, Loader2, CheckCircle2, History, Ban, Pencil, Check, X, ShoppingCart, Layers, Search, Minus, Plus, Store } from "lucide-react"
import { fmtDateBR } from "@/lib/tz"
import { printWhenReady } from "@/components/print/print-utils"
import MarketplacePrintSheet from "./MarketplacePrintSheet"
import { ProdutoCard, KitCard, type CatalogVariant, type KitTemplate } from "./Cards"
import RelatorioBaixas, { lojaLabel, type Loja } from "./RelatorioBaixas"
import { flyToCart } from "./flyToCart"

// ─── Types ────────────────────────────────────────────────────────────────────

// "Carrinho" — cada linha já é uma escolha real de produto/cor/tamanho,
// vira baixa de estoque de verdade ao confirmar.
type ManualRow = {
  id: string; variantId: string; productName: string; color: string; size: string
  sku: string; stock: number; qty: number
  kitGroupId?: string // peças que vieram do mesmo kit — editam quantidade juntas
}

type SeparationDetailItem = { id: number; variantId: string; productName: string; color: string; size: string; sku: string; qty: number }
type SeparationDetail = {
  id: number; number: string; origin: string; totalItems: number; totalPieces: number
  createdAt: string; canceledAt: string | null; items: SeparationDetailItem[]
}

let rowSeq = 0
const newRowId = () => `row-${Date.now()}-${rowSeq++}`
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"

function CartStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-white border border-[#0F1E3C]/12 rounded-lg px-1 py-0.5 flex-shrink-0">
      <button type="button" aria-label="Menos" onClick={() => onChange(Math.max(1, value - 1))} className="p-0.5 text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><Minus size={12} /></button>
      <input type="number" min={1} value={value} onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-8 bg-transparent text-center text-xs font-black text-[#0F1E3C] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" aria-label="Mais" onClick={() => onChange(value + 1)} className="p-0.5 text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><Plus size={12} /></button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [tab, setTab] = useState<"lancar" | "relatorio">("lancar")

  // ── Lojas — dropdown editável (renomear) + "+ Adicionar loja" inline ──
  const [lojas, setLojas] = useState<Loja[]>([])
  const [lojaId, setLojaId] = useState<number | null>(null)
  const [addingLoja, setAddingLoja] = useState(false)
  const [newLojaNome, setNewLojaNome] = useState("")
  const [renamingLoja, setRenamingLoja] = useState(false)
  const [renameLojaNome, setRenameLojaNome] = useState("")
  const [savingLoja, setSavingLoja] = useState(false)
  const [lojaError, setLojaError] = useState("")

  const loadLojas = useCallback(async () => {
    const res = await fetch("/api/marketplace/lojas")
    if (res.ok) {
      const data: Loja[] = await res.json()
      setLojas(data)
      setLojaId(prev => (prev && data.some(l => l.id === prev)) ? prev : (data[0]?.id ?? null))
    }
  }, [])
  useEffect(() => { loadLojas() }, [loadLojas])

  async function createLoja() {
    if (!newLojaNome.trim()) return
    setSavingLoja(true); setLojaError("")
    try {
      const res = await fetch("/api/marketplace/lojas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: newLojaNome.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLojaError(data.error ?? "Não deu pra criar a loja"); return }
      setNewLojaNome(""); setAddingLoja(false)
      setLojas(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setLojaId(data.id)
    } finally { setSavingLoja(false) }
  }
  function startRenameLoja() {
    const l = lojas.find(l => l.id === lojaId)
    if (!l) return
    setRenameLojaNome(l.nome); setRenamingLoja(true); setLojaError("")
  }
  async function saveRenameLoja() {
    if (!lojaId || !renameLojaNome.trim()) return
    setSavingLoja(true); setLojaError("")
    try {
      const res = await fetch(`/api/marketplace/lojas/${lojaId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: renameLojaNome.trim() }),
      })
      if (!res.ok) { setLojaError((await res.json().catch(() => ({}))).error ?? "Não deu pra renomear"); return }
      setRenamingLoja(false); await loadLojas()
    } finally { setSavingLoja(false) }
  }

  // ── Catálogo ──
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

  const [busca, setBusca] = useState("")
  const produtos = useMemo(() => {
    const byProd = new Map<string, CatalogVariant[]>()
    for (const v of catalog) {
      if (!byProd.has(v.productId)) byProd.set(v.productId, [])
      byProd.get(v.productId)!.push(v)
    }
    const termos = semAcento(busca).split(/\s+/).filter(Boolean)
    return [...byProd.entries()]
      .map(([productId, variants]) => ({ productId, productName: variants[0].productName, variants }))
      .filter(p => !termos.length || termos.every(t => semAcento(`${p.productName} ${p.variants.map(v => `${v.color} ${v.size}`).join(" ")}`).includes(t)))
      .sort((a, b) => a.productName.localeCompare(b.productName))
  }, [catalog, busca])
  const productList = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of catalog) map.set(c.productId, c.productName)
    return [...map.entries()].map(([productId, productName]) => ({ productId, productName })).sort((a, b) => a.productName.localeCompare(b.productName))
  }, [catalog])

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
  const kitsVisiveis = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean)
    return kitTemplates.filter(t => !termos.length || termos.every(x => semAcento(`kit ${t.nome} ${t.items.map(i => i.productName).join(" ")}`).includes(x)))
  }, [kitTemplates, busca])

  // ── Carrinho ──
  const [manualRows, setManualRows] = useState<ManualRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState("")
  const [result, setResult] = useState<{ number: string; totalItems: number; totalPieces: number; items: { productName: string; color: string; size: string; sku: string; qty: number }[]; lojaNome: string } | null>(null)
  const [showResultPrint, setShowResultPrint] = useState(false)
  const cartIconRef = useRef<HTMLDivElement>(null)
  const cartBadgeRef = useRef<HTMLSpanElement>(null)

  // Peça avulsa NUNCA toca num grupo de kit (regra fechada em 14/09): soma só
  // numa linha avulsa da mesma variante. Kit soma no grupo do mesmo kit.
  function addToCart(variant: CatalogVariant, qty: number, kitGroupId?: string) {
    setManualRows(prev => {
      const existing = prev.find(r => r.variantId === variant.variantId && r.kitGroupId === kitGroupId)
      if (existing) return prev.map(r => r === existing ? { ...r, qty: r.qty + qty } : r)
      // Item novo entra no topo — o último lançado aparece primeiro.
      return [{
        id: newRowId(), variantId: variant.variantId, productName: variant.productName,
        color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock, qty, kitGroupId,
      }, ...prev]
    })
    setConfirmError("")
  }
  function addProduto(v: CatalogVariant, qty: number, origem: DOMRect) {
    if (result) setResult(null)
    addToCart(v, qty)
    flyToCart(qty, origem, cartIconRef.current, () => cartBadgeRef.current)
  }
  function addKit(pieces: CatalogVariant[], qty: number, groupId: string, origem: DOMRect) {
    if (result) setResult(null)
    for (const p of pieces) addToCart(p, qty, groupId)
    flyToCart(qty * pieces.length, origem, cartIconRef.current, () => cartBadgeRef.current)
  }

  // Total no carrinho por variante (avulsa + kits) — usado no selo do chip de
  // tamanho e no aviso de estoque, que olham a peça física, não a linha.
  const qtyByVariant = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of manualRows) m.set(r.variantId, (m.get(r.variantId) ?? 0) + r.qty)
    return m
  }, [manualRows])
  const cartQtyFor = useCallback((variantId: string) => qtyByVariant.get(variantId) ?? 0, [qtyByVariant])
  const falta = (r: ManualRow) => (qtyByVariant.get(r.variantId) ?? 0) > r.stock

  function updateManualQty(id: string, qty: number) {
    setManualRows(prev => prev.map(r => r.id === id ? { ...r, qty: Math.max(1, qty || 1) } : r))
  }
  function removeManualRow(id: string) {
    setManualRows(prev => prev.filter(r => r.id !== id))
  }
  // Peças do mesmo kit editam quantidade juntas — sempre 1 de cada por kit.
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
  const kitNomeDe = (groupId: string) => kitTemplates.find(t => groupId.startsWith(`kit-${t.id}-`))?.nome ?? "Kit"

  const totals = useMemo(() => ({
    linhas: manualRows.length,
    pecas: manualRows.reduce((s, r) => s + r.qty, 0),
  }), [manualRows])
  const algumaFalta = manualRows.some(falta)

  async function confirmSeparation() {
    if (manualRows.length === 0) return
    if (!lojaId) { setConfirmError("Escolha a loja antes de confirmar"); return }
    setConfirming(true); setConfirmError("")
    try {
      const res = await fetch("/api/marketplace/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lojaId, rows: manualRows.map(r => ({ variantId: r.variantId, qty: r.qty })) }),
      })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.error ?? "Erro ao confirmar"); return }
      setResult({ ...data, lojaNome: lojas.find(l => l.id === lojaId)?.nome ?? "" })
      setManualRows([])
      setReloadKey(k => k + 1)
      loadCatalog()
    } catch {
      setConfirmError("Falha de rede ao confirmar")
    } finally {
      setConfirming(false)
    }
  }

  // ── Relatório de baixas + detalhe ──
  const [reloadKey, setReloadKey] = useState(0)
  const [detail, setDetail] = useState<SeparationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [canceling, setCanceling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editingQty, setEditingQty] = useState(1)
  const [savingQty, setSavingQty] = useState(false)
  const [showDetailPrint, setShowDetailPrint] = useState(false)

  async function openDetail(id: number) {
    setDetail(null); setDetailError(""); setDetailLoading(true); setConfirmCancel(false)
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
    setDetail(null); setDetailError(""); setEditingItemId(null); setConfirmCancel(false)
  }
  async function cancelDetail() {
    if (!detail) return
    setCanceling(true)
    try {
      const res = await fetch(`/api/marketplace/separations/${detail.id}/cancel`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setDetailError(data.error ?? "Erro ao cancelar"); return }
      setConfirmCancel(false)
      await openDetail(detail.id)
      setReloadKey(k => k + 1); loadCatalog()
    } finally {
      setCanceling(false)
    }
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
      setReloadKey(k => k + 1); loadCatalog()
    } finally {
      setSavingQty(false)
    }
  }

  return (
    <div className="max-w-[1500px] space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Marketplace</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
            {tab === "lancar"
              ? "Escolha cor, tamanho e quantidade em cada produto e confirme o carrinho pra dar baixa no estoque."
              : "Filtre por loja e período: as quantidades aparecem somadas por produto e as baixas logo abaixo."}
          </p>
        </div>
        <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold bg-white shadow-sm">
          <button onClick={() => setTab("lancar")} data-testid="mkt-tab-lancar"
            className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${tab === "lancar" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
            <ShoppingCart size={14} /> Lançar
          </button>
          <button onClick={() => setTab("relatorio")} data-testid="mkt-tab-relatorio"
            className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${tab === "relatorio" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
            <History size={14} /> Relatório de baixas
          </button>
        </div>
      </div>

      {tab === "lancar" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">

          {/* ── Catálogo em cards ── */}
          <div className="space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Filtrar por produto, cor ou tamanho"
                  className="w-full bg-white border border-[#0F1E3C]/10 rounded-xl pl-10 pr-9 py-2.5 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                {busca && (
                  <button onClick={() => setBusca("")} aria-label="Limpar filtro" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 hover:text-[#0F1E3C]"><X size={14} /></button>
                )}
              </div>
              <button onClick={() => { setKitTemplateOpen(true); loadKitTemplates() }}
                className="flex items-center justify-center gap-1.5 text-xs font-bold text-[#0F1E3C]/60 hover:text-[#4361EE] bg-white border border-[#0F1E3C]/10 hover:border-[#4361EE]/30 rounded-xl px-3.5 py-2.5 shadow-sm transition-colors">
                <Layers size={13} /> Modelos de kit
              </button>
            </div>

            {catalogLoading && catalog.length === 0 ? (
              <div className="grid grid-cols-1 min-[1360px]:grid-cols-2 min-[1760px]:grid-cols-3 gap-4">
                {[0, 1, 2, 3].map(i => <div key={i} className="h-64 rounded-2xl bg-white border border-[#0F1E3C]/6 animate-pulse" />)}
              </div>
            ) : produtos.length === 0 && kitsVisiveis.length === 0 ? (
              <p className="text-sm text-[#0F1E3C]/40 bg-white rounded-2xl border border-[#0F1E3C]/8 px-5 py-10 text-center">Nenhum produto com esse filtro.</p>
            ) : (
              <div className="grid grid-cols-1 min-[1360px]:grid-cols-2 min-[1760px]:grid-cols-3 gap-4 items-stretch">
                {kitsVisiveis.map(t => (
                  <KitCard key={`kit-${t.id}`} template={t} catalog={catalog} onAdd={addKit} />
                ))}
                {produtos.map(p => (
                  <ProdutoCard key={p.productId} productName={p.productName} variants={p.variants} cartQtyFor={cartQtyFor} onAdd={addProduto} />
                ))}
              </div>
            )}
          </div>

          {/* ── Carrinho fixo na lateral ── */}
          <aside data-testid="mkt-carrinho" className="lg:sticky lg:top-4 bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm flex flex-col overflow-hidden lg:max-h-[calc(100vh-2rem)]">

            <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div ref={cartIconRef} className="relative w-9 h-9 rounded-xl bg-[#4361EE]/10 text-[#4361EE] flex items-center justify-center">
                  <ShoppingCart size={17} />
                  {totals.pecas > 0 && (
                    <span ref={cartBadgeRef} data-testid="mkt-carrinho-qtd"
                      className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-[#4361EE] text-white rounded-full text-[10px] font-black flex items-center justify-center tabular-nums">
                      {totals.pecas}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-black text-[#0F1E3C] leading-tight">Carrinho</p>
                  <p className="text-[11px] text-[#0F1E3C]/40 leading-tight">{totals.linhas ? `${totals.linhas} ${totals.linhas === 1 ? "linha" : "linhas"} · ${totals.pecas} pç` : "vazio"}</p>
                </div>
              </div>
              {!result && manualRows.length > 0 && (
                <button onClick={() => setManualRows([])} className="text-xs text-red-400 hover:text-red-600 font-semibold transition-colors">Limpar</button>
              )}
            </div>

            {!result ? (
              <>
                {/* Loja — obrigatória pra confirmar */}
                <div className="px-4 pt-3 pb-1 flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1 flex items-center gap-1"><Store size={11} /> Loja *</p>
                  {addingLoja ? (
                    <div className="flex items-center gap-1.5">
                      <input value={newLojaNome} onChange={e => setNewLojaNome(e.target.value)} placeholder="Nome da loja" autoFocus
                        onKeyDown={e => e.key === "Enter" && createLoja()} className={`${inputCls} text-xs font-semibold`} />
                      <button onClick={createLoja} disabled={!newLojaNome.trim() || savingLoja} className="p-2 rounded-lg bg-[#4361EE] text-white disabled:opacity-40 flex-shrink-0"><Check size={14} /></button>
                      <button onClick={() => { setAddingLoja(false); setNewLojaNome(""); setLojaError("") }} className="p-2 rounded-lg text-[#0F1E3C]/40 hover:text-red-500 flex-shrink-0"><X size={14} /></button>
                    </div>
                  ) : renamingLoja ? (
                    <div className="flex items-center gap-1.5">
                      <input value={renameLojaNome} onChange={e => setRenameLojaNome(e.target.value)} autoFocus
                        onKeyDown={e => e.key === "Enter" && saveRenameLoja()} className={`${inputCls} text-xs font-semibold`} />
                      <button onClick={saveRenameLoja} disabled={!renameLojaNome.trim() || savingLoja} className="p-2 rounded-lg bg-[#4361EE] text-white disabled:opacity-40 flex-shrink-0"><Check size={14} /></button>
                      <button onClick={() => { setRenamingLoja(false); setLojaError("") }} className="p-2 rounded-lg text-[#0F1E3C]/40 hover:text-red-500 flex-shrink-0"><X size={14} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <select value={lojaId ?? ""} onChange={e => e.target.value === "__new__" ? setAddingLoja(true) : setLojaId(Number(e.target.value))}
                        className={`${inputCls} text-xs font-bold ${!lojaId ? "border-amber-300" : ""}`}>
                        {lojas.length === 0 && <option value="">Nenhuma loja cadastrada</option>}
                        {lojas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                        <option value="__new__">+ Adicionar loja</option>
                      </select>
                      {lojaId != null && (
                        <button onClick={startRenameLoja} title="Renomear loja" className="p-2 rounded-lg text-[#0F1E3C]/30 hover:text-[#4361EE] hover:bg-[#4361EE]/8 flex-shrink-0"><Pencil size={13} /></button>
                      )}
                    </div>
                  )}
                  {lojaError && <p className="text-[11px] text-red-600 mt-1">{lojaError}</p>}
                </div>

                {/* Itens */}
                <div className="px-4 py-3 overflow-y-auto flex-1 min-h-[120px]">
                  {manualRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#0F1E3C]/20">
                      <ShoppingCart size={28} strokeWidth={1.2} />
                      <p className="text-xs text-center text-[#0F1E3C]/35 max-w-[22ch]">Escolha cor, tamanho e quantidade nos cards e clique em Adicionar</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cartGroups.kitGroups.map(([groupId, rows]) => {
                        const qty = rows[0]?.qty ?? 1
                        const groupColors = [...new Set(rows.map(r => r.color))].join("/")
                        return (
                          <div key={groupId} className="bg-[#4361EE]/[0.04] border border-[#4361EE]/15 rounded-xl px-3 py-2.5 text-xs">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Layers size={12} className="text-[#4361EE] flex-shrink-0" />
                                <span className="text-[11px] font-black text-[#4361EE] truncate">{kitNomeDe(groupId)} · {groupColors} · {rows[0]?.size}</span>
                              </div>
                              <button onClick={() => removeKitGroup(groupId)} aria-label="Remover kit" className="text-[#0F1E3C]/25 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
                            </div>
                            <div className="space-y-1 mb-2">
                              {rows.map(r => (
                                <div key={r.id} className="flex items-center gap-2 min-w-0">
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${falta(r) ? "bg-red-500" : "bg-emerald-500"}`} />
                                  <span className="text-[#0F1E3C]/70 truncate">{r.productName}</span>
                                  {falta(r) && <span className="text-[10px] font-bold text-red-500 flex-shrink-0">estoque {r.stock}</span>}
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-[#0F1E3C]/40">kits</span>
                              <CartStepper value={qty} onChange={n => updateKitGroupQty(groupId, n)} />
                            </div>
                          </div>
                        )
                      })}
                      {cartGroups.solo.map(r => (
                        <div key={r.id} className="flex items-center justify-between gap-2 bg-[#F6F7FB] rounded-xl px-3 py-2.5 text-xs">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${falta(r) ? "bg-red-500" : "bg-emerald-500"}`} title={falta(r) ? "Vai deixar o estoque negativo" : "Tem estoque"} />
                            <div className="min-w-0">
                              <p className="font-bold text-[#0F1E3C] truncate">{r.productName}</p>
                              <p className="text-[#0F1E3C]/50 text-[11px]">{r.color} · {r.size}{falta(r) && <span className="text-red-500 font-bold"> · estoque {r.stock}</span>}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <CartStepper value={r.qty} onChange={n => updateManualQty(r.id, n)} />
                            <button onClick={() => removeManualRow(r.id)} aria-label="Remover" className="text-[#0F1E3C]/25 hover:text-red-500"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rodapé */}
                <div className="px-4 py-3.5 bg-[#F4F6FB] border-t border-[#0F1E3C]/8 flex-shrink-0 space-y-2.5">
                  {algumaFalta && <p className="text-[11px] font-semibold text-orange-600">Tem peça acima do estoque do sistema (marcada em vermelho). Dá pra confirmar, o estoque fica negativo.</p>}
                  {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex gap-5">
                      <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Linhas</p><p className="text-base font-black text-[#0F1E3C] tabular-nums">{totals.linhas}</p></div>
                      <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Peças</p><p className="text-base font-black text-[#0F1E3C] tabular-nums">{totals.pecas} pç</p></div>
                    </div>
                    <button onClick={confirmSeparation} disabled={manualRows.length === 0 || !lojaId || confirming} data-testid="mkt-confirmar"
                      className="bg-[#4361EE] hover:bg-[#3651d4] disabled:opacity-40 text-white text-sm font-bold px-5 py-2.5 rounded-xl flex items-center gap-1.5 transition-colors">
                      {confirming && <Loader2 size={14} className="animate-spin" />} {!lojaId ? "Escolha a loja" : "Confirmar baixa"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-5">
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3"><CheckCircle2 size={26} /></div>
                  <h2 className="text-lg font-black text-[#0F1E3C]">Baixa confirmada</h2>
                  <p className="text-sm text-[#0F1E3C]/45 mt-0.5">{result.number} · {result.lojaNome} · {result.totalPieces} peças</p>
                  <p className="text-xs text-[#0F1E3C]/35 mt-0.5">Estoque descontado</p>
                </div>
                <div className="flex justify-center gap-2">
                  <button onClick={() => { setShowResultPrint(true); printWhenReady() }} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#F4F6FB]">
                    <Printer size={14} /> Imprimir ficha
                  </button>
                  <button onClick={() => { setResult(null); setConfirmError("") }} className="bg-[#4361EE] text-white text-sm font-bold px-4 py-2.5 rounded-xl">Nova baixa</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "relatorio" && <RelatorioBaixas lojas={lojas} reloadKey={reloadKey} onOpenDetail={openDetail} />}

      {/* Modal de detalhe da baixa — editar / cancelar / reimprimir */}
      {(detailLoading || detail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDetail}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div>
                <h2 className="font-black text-[#0F1E3C]">{detail?.number ?? "Baixa"}</h2>
                {detail && (
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {fmtDateBR(detail.createdAt)} · {lojaLabel(detail.origin)} · {detail.totalPieces} peças
                    {detail.canceledAt && <span className="text-red-500 font-bold"> · Cancelada</span>}
                  </p>
                )}
              </div>
              <button onClick={closeDetail} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {detailLoading && <p className="text-xs text-[#0F1E3C]/40 text-center py-6">Carregando…</p>}
              {detailError && <p className="text-xs text-red-600 text-center py-3">{detailError}</p>}
              {detail && (
                <div className="space-y-1.5">
                  {detail.items.map(it => (
                    <div key={it.id} className="flex items-center justify-between gap-3 bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-bold text-[#0F1E3C] truncate">{it.productName}</p>
                        <p className="text-[11px] text-[#0F1E3C]/50">{it.color} · {it.size}</p>
                      </div>
                      {editingItemId === it.id ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <input type="number" min={1} value={editingQty} onChange={e => setEditingQty(parseInt(e.target.value) || 1)}
                            className="w-14 text-center border border-[#4361EE]/40 rounded-lg py-1 text-xs tabular-nums" autoFocus />
                          <button onClick={() => saveEditQty(it.id)} disabled={savingQty} className="text-emerald-600 hover:text-emerald-700"><Check size={15} /></button>
                          <button onClick={() => setEditingItemId(null)} className="text-[#0F1E3C]/30 hover:text-red-500"><X size={15} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="tabular-nums font-black text-[#0F1E3C]">{it.qty} pç</span>
                          {!detail.canceledAt && (
                            <button onClick={() => { setEditingItemId(it.id); setEditingQty(it.qty) }} className="text-[#0F1E3C]/30 hover:text-[#4361EE]"><Pencil size={13} /></button>
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
                <button onClick={() => { setShowDetailPrint(true); printWhenReady() }} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#F4F6FB]">
                  <Printer size={13} /> Reimprimir
                </button>
                {!detail.canceledAt && (confirmCancel ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[#0F1E3C]/50">Estornar o estoque?</span>
                    <button onClick={cancelDetail} disabled={canceling} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-xl">
                      {canceling ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Sim, cancelar
                    </button>
                    <button onClick={() => setConfirmCancel(false)} className="text-xs font-bold text-[#0F1E3C]/50 px-2 py-2">Não</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmCancel(true)} className="flex items-center gap-1.5 text-red-500 hover:text-red-600 text-xs font-bold px-3 py-2 rounded-xl border border-red-200">
                    <Ban size={13} /> Cancelar e estornar estoque
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de modelos de kit */}
      {kitTemplateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setKitTemplateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <div>
                <h2 className="font-black text-[#0F1E3C]">Modelos de kit</h2>
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5 max-w-[38ch]">Nome do kit e quais produtos compõem ele. Cor e tamanho de cada peça são escolhidos no card do kit.</p>
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
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produtos do kit (marque 2 ou mais)</p>
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {productList.map(p => (
                    <label key={p.productId} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-[#F9FAFB] cursor-pointer">
                      <input type="checkbox" checked={newKitProductIds.has(p.productId)} onChange={() => toggleNewKitProduct(p.productId)} className="w-3.5 h-3.5 rounded accent-[#4361EE]" />
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

      {showResultPrint && result && (
        <MarketplacePrintSheet result={result} origin={result.lojaNome} onDone={() => setShowResultPrint(false)} />
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
