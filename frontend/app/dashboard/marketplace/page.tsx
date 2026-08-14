"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Printer, Link2, Plus, Trash2, X, Loader2, CheckCircle2, PackageSearch } from "lucide-react"
import { fmtDateBR } from "@/lib/tz"
import { colorSwatch } from "@/lib/colorSwatch"
import { sizeCompare } from "@/lib/sizeOrder"
import { printWhenReady } from "@/components/print/print-utils"
import MarketplacePrintSheet from "./MarketplacePrintSheet"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatalogVariant = {
  variantId: string; productId: string; productName: string; categoryName: string
  color: string; size: string; sku: string; availableStock: number
}

type ReviewRow = {
  id: string
  raw: string
  title: string
  variacao: string
  marketplaceSku: string
  variantId: string | null
  productName: string | null; color: string | null; size: string | null; sku: string | null
  categoryName: string | null
  stock: number | null
  qty: number
  source: "regra" | "ia" | "memoria" | "manual" | null
  unresolved: boolean
  remember: boolean
  isKit: boolean
  qtyPerKit: number
  timesUsed: number | null
  expectedProductName: string | null
}

type AssociationItem = { productId: string; qty: number; productName: string }
type Association = {
  id: number; prefix: string; kind: "single" | "kit"; origin: string; createdAt: string
  productId: string | null; productName: string | null
  items?: AssociationItem[]
}

type HistoryRow = {
  id: number; number: string; origin: string; totalItems: number; totalPieces: number; createdAt: string
}

type MemoryItem = { matchId: number; productName: string; color: string | null; size: string | null; qtyPerKit: number; pieceLabel: string | null }
type MemoryMatch = {
  id: number; sku: string; isKit: boolean; confirmedBy: "ai_auto" | "user_edit"; timesUsed: number
  createdAt: string; lastUsedAt: string; items: MemoryItem[]
}

type Origin = "shopee" | "mercado_livre" | "manual"
const ORIGIN_LABEL: Record<Origin, string> = { shopee: "Shopee", mercado_livre: "Mercado Livre", manual: "Manual" }

let rowSeq = 0
const newRowId = () => `row-${Date.now()}-${rowSeq++}`

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [mode, setMode] = useState<"upload" | "manual">("upload")
  const [origin, setOrigin] = useState<Origin>("shopee")

  const [catalog, setCatalog] = useState<CatalogVariant[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)

  const [processing, setProcessing] = useState(false)
  const [processMsg, setProcessMsg] = useState("")
  const [uploadError, setUploadError] = useState("")
  const [pastedText, setPastedText] = useState("")
  const [showPaste, setShowPaste] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])
  const [sourceSummary, setSourceSummary] = useState<{ pedidos: number | null; totalItens: number | null } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState("")
  const [result, setResult] = useState<{ number: string; totalItems: number; totalPieces: number; items: { productName: string; color: string; size: string; sku: string; qty: number }[] } | null>(null)

  const [history, setHistory] = useState<HistoryRow[]>([])

  const [assocOpen, setAssocOpen] = useState(false)
  const [associations, setAssociations] = useState<Association[]>([])
  const [assocLoading, setAssocLoading] = useState(false)
  const [newAssocKind, setNewAssocKind] = useState<"single" | "kit">("single")
  const [newPrefix, setNewPrefix] = useState("")
  const [newAssocProduct, setNewAssocProduct] = useState("")
  // Kit: peças acumuladas antes de salvar a associação
  const [kitPieces, setKitPieces] = useState<{ productId: string; productName: string; qty: number }[]>([])
  const [kitName, setKitName] = useState("")
  const [kitQty, setKitQty] = useState(1)
  const [kitPieceFlash, setKitPieceFlash] = useState<string | null>(null)
  const kitFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showPrint, setShowPrint] = useState(false)

  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryEntries, setMemoryEntries] = useState<MemoryMatch[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)

  // Modal de vínculo — produto → cor → tamanho, igual o "adicionar ao carrinho" do PDV
  const [linkTargetIds, setLinkTargetIds] = useState<string[]>([])
  const [linkProductName, setLinkProductName] = useState("")

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const res = await fetch("/api/stock/balance")
      if (res.ok) setCatalog(await res.json())
    } finally { setCatalogLoading(false) }
  }, [])

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/marketplace/history")
    if (res.ok) setHistory(await res.json())
  }, [])

  const loadAssociations = useCallback(async () => {
    setAssocLoading(true)
    try {
      const res = await fetch("/api/marketplace/associations")
      if (res.ok) setAssociations(await res.json())
    } finally { setAssocLoading(false) }
  }, [])

  useEffect(() => { loadCatalog(); loadHistory() }, [loadCatalog, loadHistory])

  const productNames = useMemo(() => [...new Set(catalog.map(c => c.productName))].sort(), [catalog])

  // ── Upload / IA ──
  async function runParse(payload: FormData) {
    setProcessing(true); setUploadError(""); setProcessMsg("Lendo o arquivo e conferindo com o catálogo…")
    try {
      const res = await fetch("/api/marketplace/parse", { method: "POST", body: payload })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? "Erro ao analisar"); return }

      const rows: ReviewRow[] = data.rows.map((r: {
        raw: string; title: string; variacao: string; marketplaceSku: string; variantId: string | null; productName: string | null; color: string | null
        size: string | null; sku: string | null; categoryName: string | null; stock: number | null; qty: number
        source: "regra" | "ia" | "memoria" | null; unresolved: boolean; isKit: boolean; qtyPerKit: number; timesUsed: number | null
        expectedProductName: string | null
      }) => ({ id: newRowId(), ...r, remember: r.source === "ia" || r.unresolved }))
      setReviewRows(rows)
      setSourceSummary(data.sourceSummary ?? null)
      setStep(2)
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

  // ── Manual mode ──
  const [manualName, setManualName] = useState("")
  const [manualColor, setManualColor] = useState("")
  const [manualSize, setManualSize] = useState("")
  const [manualQty, setManualQty] = useState(1)

  // Cascata produto→cor→tamanho calculada no render (sem efeito) — se a seleção
  // salva não existe mais nas opções atuais, cai pra primeira disponível.
  const effName = productNames.includes(manualName) ? manualName : (productNames[0] ?? "")
  const manualColors = useMemo(() => [...new Set(catalog.filter(c => c.productName === effName).map(c => c.color))], [catalog, effName])
  const effColor = manualColors.includes(manualColor) ? manualColor : (manualColors[0] ?? "")
  const manualSizes = useMemo(() => catalog.filter(c => c.productName === effName && c.color === effColor), [catalog, effName, effColor])
  const effSize = manualSizes.some(v => v.size === manualSize) ? manualSize : (manualSizes[0]?.size ?? "")

  function addManualRow() {
    const variant = catalog.find(c => c.productName === effName && c.color === effColor && c.size === effSize)
    if (!variant) return
    setReviewRows(prev => [...prev, {
      id: newRowId(), raw: `${variant.productName} ${variant.color} ${variant.size}`, title: "", variacao: "", marketplaceSku: "",
      variantId: variant.variantId, productName: variant.productName, color: variant.color, size: variant.size, categoryName: variant.categoryName,
      sku: variant.sku, stock: variant.availableStock, qty: Math.max(1, manualQty),
      source: "manual", unresolved: false, remember: false, isKit: false, qtyPerKit: 1, timesUsed: null, expectedProductName: null,
    }])
  }

  function goToReviewFromManual() {
    if (reviewRows.length === 0) return
    setStep(2)
  }

  // ── Review actions ──
  function updateQty(id: string, qty: number) {
    setReviewRows(prev => prev.map(r => r.id === id ? { ...r, qty: Math.max(1, qty || 1) } : r))
  }
  function removeRow(id: string) {
    setReviewRows(prev => prev.filter(r => r.id !== id))
  }
  function removeRows(ids: string[]) {
    setReviewRows(prev => prev.filter(r => !ids.includes(r.id)))
  }
  function toggleRemember(id: string, val: boolean) {
    setReviewRows(prev => prev.map(r => r.id === id ? { ...r, remember: val } : r))
  }
  // Remapear é sempre possível — não só nas linhas "não encontrada". Trocar o
  // mapeamento na mão sempre vira source "manual" (é uma decisão explícita do
  // operador, some do controle automático dali em diante).
  function remapRow(id: string, variantId: string) {
    const variant = catalog.find(c => c.variantId === variantId)
    if (!variant) return
    setReviewRows(prev => prev.map(r => r.id === id ? {
      ...r, unresolved: false, variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, categoryName: variant.categoryName,
      stock: variant.availableStock, source: "manual",
    } : r))
  }

  // ── Modal de vínculo (produto → cor → tamanho) ──
  // Aceita várias linhas de uma vez (card com itens iguais juntados) — vincular
  // um produto novo reaplica em todas elas, já que representam a mesma decisão.
  const linkRows = useMemo(() => reviewRows.filter(r => linkTargetIds.includes(r.id)), [reviewRows, linkTargetIds])
  const linkRow = linkRows[0] ?? null
  function openLinkModal(rows: ReviewRow[]) {
    if (rows.length === 0) return
    setLinkTargetIds(rows.map(r => r.id))
    setLinkProductName(rows[0].productName ?? rows[0].expectedProductName ?? productNames[0] ?? "")
  }
  function closeLinkModal() { setLinkTargetIds([]) }
  function pickVariant(variantId: string) {
    for (const id of linkTargetIds) remapRow(id, variantId)
    closeLinkModal()
  }
  const linkColorGroups = useMemo(() => {
    const variants = catalog.filter(c => c.productName === linkProductName)
    const byColor = new Map<string, CatalogVariant[]>()
    for (const v of variants) {
      if (!byColor.has(v.color)) byColor.set(v.color, [])
      byColor.get(v.color)!.push(v)
    }
    const groups = [...byColor.entries()].sort(([a], [b]) => a.localeCompare(b))
    groups.forEach(([, vs]) => vs.sort((a, b) => sizeCompare(a.size, b.size)))
    return groups
  }, [catalog, linkProductName])

  // ── Conferência em blocos: Não mapeados sempre primeiro, Kits em seguida,
  // depois um bloco por categoria de produto presente na lista — nasce sozinho
  // do que tiver no arquivo, sem lista fixa pra manter conforme o catálogo cresce.
  // Kit com QUALQUER peça pendente cai inteiro em "Não mapeados" (precisa de
  // atenção); só entra em "Kits" quando todas as peças já estão resolvidas. ──
  type KitGroup = { key: string; pieces: ReviewRow[]; anyMiss: boolean }
  const blocks = useMemo(() => {
    const missSimple: ReviewRow[] = []
    const kitGroupsMap = new Map<string, ReviewRow[]>()
    const byCategory = new Map<string, ReviewRow[]>()

    for (const r of reviewRows) {
      if (r.isKit) {
        const key = r.marketplaceSku || r.id
        if (!kitGroupsMap.has(key)) kitGroupsMap.set(key, [])
        kitGroupsMap.get(key)!.push(r)
        continue
      }
      if (r.unresolved) { missSimple.push(r); continue }
      const cat = r.categoryName ?? "Outros"
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(r)
    }

    const kitGroups: KitGroup[] = [...kitGroupsMap.entries()].map(([key, pieces]) => ({ key, pieces, anyMiss: pieces.some(p => p.unresolved) }))
    const missKits = kitGroups.filter(k => k.anyMiss)
    const okKits = kitGroups.filter(k => !k.anyMiss)
    const categoryBlocks = [...byCategory.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, items]) => ({ id: name, label: name, items }))

    return { missSimple, missKits, okKits, categoryBlocks }
  }, [reviewRows])

  // "Itens" conta linhas do pedido (kit conta 1x, não 1x por peça) — é o que
  // bate com o que a pessoa vê no picklist original. "Peças" continua sendo o
  // total físico a separar (kit de 2 peças em qty 1 já soma 2 peças aqui).
  const totals = useMemo(() => {
    const items = blocks.missSimple.length + blocks.missKits.length + blocks.okKits.length
      + blocks.categoryBlocks.reduce((s, b) => s + b.items.length, 0)
    const pieces = reviewRows.reduce((s, r) => s + r.qty, 0)
    const pending = blocks.missSimple.length + blocks.missKits.length
    return { items, pieces, pending }
  }, [blocks, reviewRows])

  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set())
  function toggleBlock(id: string) {
    setCollapsedBlocks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // Kits/categoria abrem fechados por padrão numa lista grande — atalho pra
  // quando você quer ver tudo de uma vez (ou fechar tudo de novo depois).
  const nonMissBlockIds = useMemo(() => [
    ...(blocks.okKits.length > 0 ? ["kits"] : []),
    ...blocks.categoryBlocks.map(b => b.id),
  ], [blocks])
  function expandAllBlocks() { setCollapsedBlocks(new Set(nonMissBlockIds)) }
  function collapseAllBlocks() { setCollapsedBlocks(new Set(["miss"])) }

  async function confirmSeparation() {
    if (totals.pending > 0 || reviewRows.length === 0) return
    setConfirming(true); setConfirmError("")
    try {
      const newAssociations = reviewRows
        .filter(r => r.remember && r.variantId && r.marketplaceSku.trim())
        .map(r => {
          const variant = catalog.find(c => c.variantId === r.variantId)
          if (!variant) return null
          // Tira o pedaço final do SKU do marketplace (normalmente o tamanho) —
          // o que sobra vira o prefixo aprendido pra esse produto. Fica mais
          // estreito que um prefixo digitado na mão (ex: "cami_"), mas nunca errado.
          const prefix = r.marketplaceSku.trim().toUpperCase().replace(/[-_ ]?[A-Z0-9]{1,3}$/i, "")
          return prefix ? { prefix, productId: variant.productId } : null
        })
        .filter((a): a is { prefix: string; productId: string } => !!a)

      const res = await fetch("/api/marketplace/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          rows: reviewRows.map(r => ({
            variantId: r.variantId, qty: r.qty, source: r.source ?? "manual",
            sku: r.marketplaceSku, variacao: r.variacao, isKit: r.isKit, qtyPerKit: r.qtyPerKit,
          })),
          newAssociations,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.error ?? "Erro ao confirmar"); return }
      setResult(data)
      setStep(3)
      loadHistory()
    } catch {
      setConfirmError("Falha de rede ao confirmar")
    } finally {
      setConfirming(false)
    }
  }

  function resetFlow() {
    setReviewRows([]); setResult(null); setConfirmError(""); setUploadError(""); setSourceSummary(null)
    setPastedText(""); setShowPaste(false); setMode("upload"); setStep(1)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ── Memória de SKU (admin) ──
  async function openMemoryModal() {
    setMemoryOpen(true); setMemoryLoading(true)
    try {
      const res = await fetch("/api/marketplace/memory")
      if (res.ok) setMemoryEntries(await res.json())
    } finally { setMemoryLoading(false) }
  }
  async function deleteMemoryEntry(id: number) {
    setMemoryEntries(prev => prev.filter(m => m.id !== id))
    await fetch(`/api/marketplace/memory/${id}`, { method: "DELETE" })
  }

  // ── Associations modal ──
  function openAssocModal() {
    setAssocOpen(true); loadAssociations()
    setNewAssocKind("single"); setNewPrefix(""); setKitPieces([]); setKitPieceFlash(null)
  }
  async function deleteAssociation(id: number) {
    setAssociations(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/marketplace/associations/${id}`, { method: "DELETE" })
  }
  async function addAssociation() {
    if (!newPrefix.trim()) return
    let body: Record<string, unknown>
    if (newAssocKind === "kit") {
      if (kitPieces.length === 0) return
      body = { prefix: newPrefix, kind: "kit", items: kitPieces.map(p => ({ productId: p.productId, qty: p.qty })), origin: "manual" }
    } else {
      if (!newAssocProduct) return
      const variant = catalog.find(c => c.productName === newAssocProduct)
      if (!variant) return
      body = { prefix: newPrefix, kind: "single", productId: variant.productId, origin: "manual" }
    }
    const res = await fetch("/api/marketplace/associations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) { setNewPrefix(""); setKitPieces([]); loadAssociations() }
  }

  const kitEffName = productNames.includes(kitName) ? kitName : (productNames[0] ?? "")

  function addKitPiece() {
    const variant = catalog.find(c => c.productName === kitEffName)
    if (!variant) return
    const qty = Math.max(1, kitQty)
    setKitPieces(prev => [...prev, { productId: variant.productId, productName: variant.productName, qty }])
    setKitQty(1) // reseta pra próxima peça — deixa claro que essa já entrou na lista

    if (kitFlashTimer.current) clearTimeout(kitFlashTimer.current)
    setKitPieceFlash(`${qty}× ${variant.productName} adicionado à lista`)
    kitFlashTimer.current = setTimeout(() => setKitPieceFlash(null), 1800)
  }
  function removeKitPiece(i: number) {
    setKitPieces(prev => prev.filter((_, idx) => idx !== i))
  }

  const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"

  // ── Conferência em blocos — helpers de render ──
  function sourceLabel(r: ReviewRow): string | null {
    if (r.source === "regra") return "IA + regra salva"
    if (r.source === "ia") return "só IA"
    if (r.source === "memoria") return `já usado antes${r.timesUsed ? ` · ${r.timesUsed}×` : ""}`
    if (r.source === "manual") return "resolvido na mão"
    return null
  }

  function itemSelectCls(unresolved: boolean) {
    return `text-xs rounded-md px-1.5 py-1 w-[168px] flex-shrink-0 text-left truncate transition-colors focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 ${
      unresolved
        ? "border border-red-300 text-red-600 bg-red-50"
        : "border border-transparent bg-transparent text-[#0F1E3C]/70 font-semibold hover:border-[#0F1E3C]/15 hover:bg-white focus:border-[#4361EE] focus:bg-white"
    }`
  }

  // Botão que abre o modal produto→cor→tamanho — mesma cara de antes (texto
  // discreto quando já vinculado, caixa vermelha quando pendente), só que
  // clicar abre o modal em vez do <select> nativo.
  function renderSelect(r: ReviewRow) {
    const label = r.variantId ? `${r.productName} · ${r.color} · ${r.size}` : (r.unresolved ? "Vincular a..." : "Selecionar...")
    return (
      <button type="button" onClick={() => openLinkModal([r])} className={itemSelectCls(r.unresolved)} title={label}>
        {label}
      </button>
    )
  }

  function variantPickBtnClass(v: CatalogVariant, isCurrent: boolean): string {
    const base = "relative flex flex-col items-center px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all min-w-[48px]"
    if (v.availableStock < 0) return `${base} border-red-300 bg-red-50 text-red-500`
    if (v.availableStock === 0) return `${base} border-orange-300 bg-orange-50 text-orange-500`
    if (isCurrent) return `${base} border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]`
    return `${base} border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:bg-[#4361EE]/6`
  }
  function variantPickStockClass(v: CatalogVariant, isCurrent: boolean): string {
    if (v.availableStock < 0) return "text-red-400"
    if (v.availableStock === 0) return "text-orange-400"
    if (isCurrent) return "text-[#4361EE]/70"
    return "text-[#0F1E3C]/30"
  }

  // `indent`=true renderiza como peça de kit (linha fina, sem SKU/variação
  // repetidos — já aparecem 1x no cabeçalho do card do kit).
  function renderItemRow(r: ReviewRow, indent = false) {
    const after = r.variantId ? (r.stock ?? 0) - r.qty : null
    const low = after !== null && after < 0
    const label = sourceLabel(r)
    return (
      <div key={r.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${indent ? "border-l-2 border-[#0F1E3C]/10 ml-1" : ""} ${r.unresolved ? "bg-red-50/60" : "bg-[#F9FAFB]"}`}>
        <span className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${!r.variantId ? "bg-red-300" : low ? "bg-red-500" : "bg-emerald-500"}`}
          title={!r.variantId ? "Sem variante escolhida" : low ? "Estoque baixo — vai ficar negativo" : "Tem estoque"} />
        <div className="min-w-0 flex-1">
          {!indent && (
            <>
              <p className="font-mono text-[10px] text-[#0F1E3C]/45 truncate" title={r.marketplaceSku}>{r.marketplaceSku || "—"}</p>
              {r.variacao && <p className="text-xs font-bold text-[#0F1E3C] leading-tight truncate" title={r.variacao}>{r.variacao}</p>}
            </>
          )}
          {indent && <p className="text-[11px] font-semibold text-[#0F1E3C]/70 truncate">{r.productName ?? "peça do kit"}</p>}
          {label && <p className="text-[9px] text-[#0F1E3C]/30 mt-0.5">{label}</p>}
        </div>
        {renderSelect(r)}
        <input type="number" min={1} value={r.qty} onChange={e => updateQty(r.id, parseInt(e.target.value))}
          className="w-12 text-center border border-[#0F1E3C]/12 rounded-md py-1 text-[11px] tabular-nums flex-shrink-0" />
        {r.variantId && r.source !== "regra" && r.source !== "memoria" && (
          <label className="flex items-center gap-1 text-[9px] text-[#0F1E3C]/40 flex-shrink-0 whitespace-nowrap">
            <input type="checkbox" checked={r.remember} onChange={e => toggleRemember(r.id, e.target.checked)} className="w-2.5 h-2.5" />
            lembrar
          </label>
        )}
        <button onClick={() => removeRow(r.id)} className="text-[#0F1E3C]/25 hover:text-red-500 flex-shrink-0"><Trash2 size={12} /></button>
      </div>
    )
  }

  function renderKitCard(group: { key: string; pieces: ReviewRow[]; anyMiss: boolean }) {
    const first = group.pieces[0]
    const kitCount = first ? Math.max(1, Math.round(first.qty / (first.qtyPerKit || 1))) : 1
    return (
      <div key={group.key} className={`rounded-lg border p-2.5 ${group.anyMiss ? "border-red-200 bg-red-50/30" : "border-[#0F1E3C]/8 bg-white"}`}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-[#0F1E3C]/45 truncate" title={first?.marketplaceSku}>{first?.marketplaceSku || "—"}</p>
            {first?.variacao && <p className="text-xs font-bold text-[#0F1E3C] truncate" title={first.variacao}>{first.variacao}</p>}
          </div>
          <span className="text-[9px] font-bold text-[#0F1E3C]/35 flex-shrink-0 whitespace-nowrap">
            {kitCount} kit{kitCount > 1 ? "s" : ""} · {group.pieces.length} peça{group.pieces.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-1">
          {group.pieces.map(p => renderItemRow(p, true))}
        </div>
      </div>
    )
  }

  // Junta linhas já resolvidas que caíram na mesma variante exata (mesmo
  // produto+cor+tamanho) — comum quando o mesmo item aparece em várias linhas
  // do picklist. Só afeta a exibição: cada linha original continua existindo
  // por baixo (pra confirmar/gravar memória do jeito de sempre), só a tela
  // mostra 1 card com a soma. Grupo de 1 linha só renderiza igual antes.
  type MergedItem = { variantId: string; productName: string; color: string; size: string; qty: number; stock: number | null; rows: ReviewRow[] }
  function mergeByVariant(rows: ReviewRow[]): MergedItem[] {
    const map = new Map<string, MergedItem>()
    for (const r of rows) {
      const key = r.variantId!
      if (!map.has(key)) map.set(key, { variantId: key, productName: r.productName!, color: r.color!, size: r.size!, qty: 0, stock: r.stock, rows: [] })
      const m = map.get(key)!
      m.qty += r.qty
      m.rows.push(r)
    }
    return [...map.values()]
  }

  function renderMergedItem(m: MergedItem) {
    if (m.rows.length === 1) return renderItemRow(m.rows[0])
    const after = (m.stock ?? 0) - m.qty
    const low = after < 0
    const ids = m.rows.map(r => r.id)
    return (
      <div key={m.variantId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#F9FAFB]">
        <span className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${low ? "bg-red-500" : "bg-emerald-500"}`}
          title={low ? "Estoque baixo — vai ficar negativo" : "Tem estoque"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[#0F1E3C] leading-tight truncate">{m.productName} · {m.color} · {m.size}</p>
          <p className="text-[9px] text-[#0F1E3C]/30 mt-0.5">{m.rows.length} linhas iguais do picklist juntas</p>
        </div>
        <button type="button" onClick={() => openLinkModal(m.rows)} className={itemSelectCls(false)} title={`${m.productName} · ${m.color} · ${m.size}`}>
          {m.productName} · {m.color} · {m.size}
        </button>
        <span className="w-12 text-center text-[11px] font-bold text-[#0F1E3C] tabular-nums flex-shrink-0">{m.qty} pç</span>
        <button onClick={() => removeRows(ids)} className="text-[#0F1E3C]/25 hover:text-red-500 flex-shrink-0"><Trash2 size={12} /></button>
      </div>
    )
  }

  // "Não mapeados" começa aberto (precisa de atenção); Kits e categorias
  // começam fechados (já revisados, só o resumo importa até você querer
  // conferir de novo) — numa lista grande isso evita a tela ficar gigante só
  // com coisa que já tá certa. `collapsedBlocks` guarda quem foi alternado
  // manualmente pra fora do estado padrão, não "quem tá fechado".
  function renderBlockShell(id: string, label: string, count: number, tone: "miss" | "kit" | "cat", children: ReactNode) {
    const defaultOpen = tone === "miss"
    const isOpen = collapsedBlocks.has(id) ? !defaultOpen : defaultOpen
    const toneCls = tone === "miss" ? "border-red-200 bg-red-50/50" : tone === "kit" ? "border-[#4361EE]/15 bg-[#4361EE]/[0.03]" : "border-[#0F1E3C]/8 bg-[#F9FAFB]"
    const labelCls = tone === "miss" ? "text-red-700" : tone === "kit" ? "text-[#4361EE]" : "text-[#0F1E3C]"
    return (
      <div key={id} className={`rounded-xl border overflow-hidden ${toneCls}`}>
        <button onClick={() => toggleBlock(id)} className="w-full flex items-center justify-between px-3.5 py-2.5">
          <span className={`text-xs font-bold ${labelCls}`}>{label} <span className="font-semibold opacity-50">· {count}</span></span>
          <span className={`text-[10px] font-semibold ${labelCls} opacity-50`}>{isOpen ? "esconder" : "mostrar"}</span>
        </button>
        {isOpen && <div className="px-3 pb-3 space-y-1.5">{children}</div>}
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Separação · Marketplace</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
          Sobe o picklist do Shopee/ML (CSV, TXT ou PDF) — a IA casa com o estoque, ou monta a lista na mão. Só desconta estoque, não gera pedido nem entra no faturamento.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0">
        {[{ n: 1, label: "Enviar" }, { n: 2, label: "Conferir" }, { n: 3, label: "Concluído" }].map((s, i) => (
          <div key={s.n} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                step === s.n ? "bg-[#4361EE] text-white" : step > s.n ? "bg-emerald-500 text-white" : "bg-[#0F1E3C]/6 text-[#0F1E3C]/30"
              }`}>{step > s.n ? "✓" : s.n}</span>
              <span className={`text-xs font-bold ${step >= s.n ? "text-[#0F1E3C]" : "text-[#0F1E3C]/30"}`}>{s.label}</span>
            </div>
            {i < 2 && <div className="flex-1 h-px bg-[#0F1E3C]/8 mx-3" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="p-6">

          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/6">
                  <button onClick={() => setMode("upload")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === "upload" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Enviar picklist (IA)</button>
                  <button onClick={() => setMode("manual")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === "manual" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Montar na mão</button>
                </div>
                <div className="flex items-center gap-2">
                  <select value={origin} onChange={e => setOrigin(e.target.value as Origin)} className={`${inputCls} !w-auto text-xs font-semibold`}>
                    {(Object.keys(ORIGIN_LABEL) as Origin[]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
                  </select>
                  <button onClick={openAssocModal} className="flex items-center gap-1.5 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C] border border-[#0F1E3C]/10 rounded-xl px-3 py-2">
                    <Link2 size={13} /> Associações salvas
                  </button>
                  <button onClick={openMemoryModal} className="flex items-center gap-1.5 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C] border border-[#0F1E3C]/10 rounded-xl px-3 py-2">
                    <PackageSearch size={13} /> Memória de SKU
                  </button>
                </div>
              </div>

              {mode === "upload" ? (
                <div>
                  {!processing ? (
                    <>
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
                        className={`border-2 border-dashed rounded-2xl p-11 text-center cursor-pointer transition-colors ${dragOver ? "border-[#4361EE] bg-[#4361EE]/5" : "border-[#0F1E3C]/12 hover:border-[#4361EE]/50"}`}
                      >
                        <div className="w-12 h-12 rounded-full bg-[#0F1E3C]/5 flex items-center justify-center mx-auto mb-3">
                          <PackageSearch size={22} className="text-[#4361EE]" />
                        </div>
                        <p className="font-bold text-sm text-[#0F1E3C]">Arraste o picklist aqui</p>
                        <p className="text-xs text-[#0F1E3C]/40 mt-0.5">ou clique pra escolher o arquivo</p>
                        <p className="text-[11px] text-[#0F1E3C]/30 mt-2.5">CSV, TXT ou PDF exportado do Shopee/Mercado Livre</p>
                      </div>
                      <input ref={fileInputRef} type="file" accept=".csv,.txt,.pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

                      <div className="text-center mt-3">
                        <button onClick={() => setShowPaste(v => !v)} className="text-xs font-bold text-[#4361EE] underline">
                          {showPaste ? "Fechar" : "Não tenho um arquivo — colar o texto"}
                        </button>
                      </div>
                      {showPaste && (
                        <div className="mt-3 space-y-2">
                          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={6}
                            placeholder="Cola aqui as linhas do picklist (SKU, título, quantidade)…"
                            className={inputCls} />
                          <button onClick={handlePasteSubmit} disabled={!pastedText.trim()} className="w-full py-2.5 rounded-xl bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold">Analisar texto</button>
                        </div>
                      )}
                      {uploadError && <p className="text-xs text-red-600 mt-3 text-center">{uploadError}</p>}
                    </>
                  ) : (
                    <div className="py-14 flex flex-col items-center gap-3">
                      <Loader2 size={26} className="animate-spin text-[#4361EE]" />
                      <p className="text-sm font-semibold text-[#0F1E3C]">{processMsg || "Processando…"}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="bg-[#F4F6FB] rounded-xl px-4 py-2.5 text-xs text-[#0F1E3C]/50 mb-4">
                    Monta item por item — sem IA, sem arquivo. Cai na mesma tela de conferência de estoque.
                  </div>

                  {catalogLoading ? (
                    <p className="text-xs text-[#0F1E3C]/40">Carregando catálogo…</p>
                  ) : (
                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 80px auto" }}>
                      <select value={effName} onChange={e => setManualName(e.target.value)} className={inputCls}>
                        {productNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select value={effColor} onChange={e => setManualColor(e.target.value)} className={inputCls}>
                        {manualColors.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={effSize} onChange={e => setManualSize(e.target.value)} className={inputCls}>
                        {manualSizes.map(v => <option key={v.size} value={v.size}>{v.size}</option>)}
                      </select>
                      <input type="number" min={1} value={manualQty} onChange={e => setManualQty(parseInt(e.target.value) || 1)} className={inputCls} />
                      <button onClick={addManualRow} className="flex items-center justify-center gap-1 bg-[#4361EE] text-white rounded-xl px-3 text-xs font-bold">
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  )}

                  {reviewRows.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {reviewRows.map(r => (
                        <div key={r.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                          <span className="font-semibold text-[#0F1E3C]">{r.productName} · {r.color} · {r.size}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[#0F1E3C]/40 tabular-nums">{r.qty} pç</span>
                            <button onClick={() => removeRow(r.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-right mt-4">
                    <button onClick={goToReviewFromManual} disabled={reviewRows.length === 0}
                      className="bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold px-4 py-2 rounded-xl">
                      Conferir lista
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-bold text-[#0F1E3C]">Conferência</h2>
                  {sourceSummary && (sourceSummary.pedidos != null || sourceSummary.totalItens != null) && (
                    <p className="text-[11px] text-[#0F1E3C]/35 mt-0.5">
                      O arquivo diz:{sourceSummary.pedidos != null ? ` ${sourceSummary.pedidos} pedidos` : ""}{sourceSummary.totalItens != null ? `, ${sourceSummary.totalItens} itens no total` : ""}
                    </p>
                  )}
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    Nessa lista: {totals.items} produto{totals.items === 1 ? "" : "s"} diferente{totals.items === 1 ? "" : "s"} pra localizar, {totals.pieces} peça{totals.pieces === 1 ? "" : "s"} pra separar (kit conta cada peça){totals.pending > 0 ? ` — ${totals.pending} precisa${totals.pending > 1 ? "m" : ""} de atenção antes de confirmar` : " — tudo casado com o estoque"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {nonMissBlockIds.length > 0 && (
                    <>
                      <button onClick={expandAllBlocks} className="text-xs font-bold text-[#0F1E3C]/40 hover:text-[#4361EE]">Abrir tudo</button>
                      <span className="text-[#0F1E3C]/15">·</span>
                      <button onClick={collapseAllBlocks} className="text-xs font-bold text-[#0F1E3C]/40 hover:text-[#4361EE]">Fechar tudo</button>
                      <span className="w-px h-4 bg-[#0F1E3C]/10 mx-1" />
                    </>
                  )}
                  <button onClick={openAssocModal} className="flex items-center gap-1.5 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C] border border-[#0F1E3C]/10 rounded-xl px-3 py-2">
                    <Link2 size={13} /> Associações salvas
                  </button>
                  <button onClick={openMemoryModal} className="flex items-center gap-1.5 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C] border border-[#0F1E3C]/10 rounded-xl px-3 py-2">
                    <PackageSearch size={13} /> Memória de SKU
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {blocks.missSimple.length + blocks.missKits.length > 0 && renderBlockShell(
                  "miss", "Não mapeados", blocks.missSimple.length + blocks.missKits.length, "miss",
                  <>
                    {blocks.missSimple.map(r => renderItemRow(r))}
                    {blocks.missKits.map(g => renderKitCard(g))}
                  </>
                )}
                {blocks.okKits.length > 0 && renderBlockShell(
                  "kits", "Kits", blocks.okKits.length, "kit",
                  <>{blocks.okKits.map(g => renderKitCard(g))}</>
                )}
                {blocks.categoryBlocks.map(b => renderBlockShell(
                  b.id, b.label, b.items.length, "cat",
                  <>{mergeByVariant(b.items).map(m => renderMergedItem(m))}</>
                ))}
              </div>
              {confirmError && <p className="text-xs text-red-600 mt-3">{confirmError}</p>}
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && result && (
            <div>
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={26} />
                </div>
                <h2 className="text-lg font-bold text-[#0F1E3C]">Separação confirmada</h2>
                <p className="text-sm text-[#0F1E3C]/45 mt-0.5">{result.number} · Estoque descontado · {result.totalItems} produtos · {result.totalPieces} peças</p>
              </div>

              <div id="print-sheet" className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-7 mx-4">
                <div className="flex items-end justify-between border-b-2 border-[#0F1E3C] pb-3 mb-3">
                  <h3 className="text-lg font-bold" style={{ fontFamily: "var(--font-playfair)" }}>Lista de Separação</h3>
                  <div className="text-right text-[11px] text-[#0F1E3C]/45">
                    {ORIGIN_LABEL[origin]} · {result.number}<br />{fmtDateBR(new Date().toISOString())}
                  </div>
                </div>
                {result.items.map((it, i) => (
                  <div key={i} className="grid items-center gap-3 py-1.5 border-b border-dashed border-[#0F1E3C]/8 text-sm" style={{ gridTemplateColumns: "18px 1fr 70px" }}>
                    <span className="w-3.5 h-3.5 border border-[#0F1E3C] rounded-[3px]" />
                    <span>{it.productName} <span className="text-[#0F1E3C]/40 text-xs">· {it.color} · {it.size}</span></span>
                    <span className="font-bold text-right tabular-nums">{it.qty} pç</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-center gap-2 py-6">
                <button onClick={() => { setShowPrint(true); printWhenReady() }} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-sm font-bold px-4 py-2.5 rounded-xl">
                  <Printer size={14} /> Imprimir lista
                </button>
                <button onClick={resetFlow} className="bg-[#4361EE] text-white text-sm font-bold px-4 py-2.5 rounded-xl">Nova separação</button>
              </div>
            </div>
          )}
        </div>

        {step === 2 && (
          <div className="flex items-center justify-between gap-4 flex-wrap px-6 py-4 bg-[#F4F6FB] border-t border-[#0F1E3C]/8">
            <div className="flex gap-6">
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produtos</p><p className="text-lg font-black text-[#0F1E3C] tabular-nums">{totals.items}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Peças</p><p className="text-lg font-black text-[#0F1E3C] tabular-nums">{totals.pieces} pç</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Pendências</p><p className="text-lg font-black text-red-600 tabular-nums">{totals.pending}</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="border border-[#0F1E3C]/10 text-[#0F1E3C] text-sm font-bold px-4 py-2.5 rounded-xl">Voltar</button>
              <button onClick={confirmSeparation} disabled={totals.pending > 0 || totals.items === 0 || confirming}
                className="bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5">
                {confirming && <Loader2 size={14} className="animate-spin" />} Confirmar separação
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Histórico */}
      <div>
        <h2 className="text-sm font-bold text-[#0F1E3C] mb-2.5">Histórico de listas</h2>
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          {history.length === 0 ? (
            <p className="text-xs text-[#0F1E3C]/40 px-5 py-6 text-center">Nenhuma separação registrada ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30 bg-[#F9FAFB]">
                  <th className="text-left px-5 py-2.5">Número</th>
                  <th className="text-left px-5 py-2.5">Data</th>
                  <th className="text-left px-5 py-2.5">Origem</th>
                  <th className="text-left px-5 py-2.5">Itens</th>
                  <th className="text-left px-5 py-2.5">Peças</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-t border-[#0F1E3C]/5">
                    <td className="px-5 py-2.5 font-semibold text-[#0F1E3C]">{h.number}</td>
                    <td className="px-5 py-2.5 text-[#0F1E3C]/50 tabular-nums">{fmtDateBR(h.createdAt)}</td>
                    <td className="px-5 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/50">{ORIGIN_LABEL[h.origin as Origin] ?? h.origin}</span></td>
                    <td className="px-5 py-2.5 tabular-nums">{h.totalItems}</td>
                    <td className="px-5 py-2.5 tabular-nums">{h.totalPieces} pç</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal associações */}
      {assocOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAssocOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[84vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <div>
                <h2 className="font-bold text-[#0F1E3C]">Associações de SKU</h2>
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5 max-w-[42ch]">Prefixo do SKU do marketplace → produto/cor (ou um kit de várias peças). Criadas quando você resolve um item novo na conferência.</p>
              </div>
              <button onClick={() => setAssocOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              {assocLoading ? (
                <p className="text-xs text-[#0F1E3C]/40">Carregando…</p>
              ) : associations.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/40 text-center py-6">Nenhuma associação salva ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30">
                      <th className="text-left pb-2">Prefixo</th><th className="text-left pb-2">Mapeado para</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {associations.map(a => (
                      <tr key={a.id} className="border-t border-[#0F1E3C]/5 align-top">
                        <td className="py-2 pr-2">
                          <p className="font-mono text-xs bg-[#F4F6FB] rounded px-1.5 py-0.5 w-fit">{a.prefix}</p>
                          {a.kind === "kit" && <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#4361EE]/10 text-[#4361EE]">KIT</span>}
                        </td>
                        <td className="py-2">
                          {a.kind === "kit" ? (
                            <ul className="space-y-0.5">
                              {(a.items ?? []).map((it, i) => (
                                <li key={i} className="text-xs text-[#0F1E3C]">{it.qty}× {it.productName} <span className="text-[#0F1E3C]/35">— cor/tamanho pela variação</span></li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-[#0F1E3C]">{a.productName} <span className="text-[#0F1E3C]/35">— cor/tamanho pela variação</span></p>
                          )}
                        </td>
                        <td className="py-2 text-right"><button onClick={() => deleteAssociation(a.id)} className="text-[#0F1E3C]/30 hover:text-red-500"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="mt-4 pt-4 border-t border-dashed border-[#0F1E3C]/10">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/6 w-fit mb-3">
                  <button onClick={() => setNewAssocKind("single")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${newAssocKind === "single" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Simples</button>
                  <button onClick={() => setNewAssocKind("kit")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${newAssocKind === "kit" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Kit (várias peças)</button>
                </div>

                {newAssocKind === "single" ? (
                  <div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                      <input value={newPrefix} onChange={e => setNewPrefix(e.target.value)} placeholder="Ex: CAMI_ ou MOL_" className={inputCls} />
                      <select value={newAssocProduct} onChange={e => setNewAssocProduct(e.target.value)} className={inputCls}>
                        <option value="">Produto...</option>
                        {productNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <button onClick={addAssociation} className="bg-[#4361EE] text-white text-xs font-bold rounded-xl px-3">+ Add</button>
                    </div>
                    <p className="text-[10.5px] text-[#0F1E3C]/35 mt-1.5">Cor e tamanho não entram aqui — são lidos direto da variação de cada item no picklist.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <input value={newPrefix} onChange={e => setNewPrefix(e.target.value)} placeholder="Prefixo do SKU do kit — ex: KIT_INF_" className={inputCls} />
                    <p className="text-[10.5px] text-[#0F1E3C]/35">Lista só os produtos que compõem o kit — cor e tamanho de cada peça vêm da variação do picklist, igual no simples.</p>

                    {kitPieces.length > 0 && (
                      <div className="space-y-1">
                        {kitPieces.map((p, i) => (
                          <div key={i} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-1.5 text-xs">
                            <span className="font-semibold text-[#0F1E3C] flex items-center gap-1.5">
                              <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                              {p.qty}× {p.productName}
                            </span>
                            <button onClick={() => removeKitPiece(i)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 70px auto" }}>
                      <select value={kitEffName} onChange={e => setKitName(e.target.value)} className={inputCls}>
                        {productNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <input type="number" min={1} value={kitQty} onChange={e => setKitQty(parseInt(e.target.value) || 1)} className={inputCls} />
                      <button onClick={addKitPiece} className="flex items-center justify-center gap-1 border border-[#0F1E3C]/12 text-[#0F1E3C] rounded-xl px-2 text-xs font-bold">
                        <Plus size={13} /> Peça
                      </button>
                    </div>
                    {kitPieceFlash && (
                      <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> {kitPieceFlash} — clica em mais peças ou em &quot;Salvar kit&quot; pra fechar
                      </p>
                    )}

                    <button onClick={addAssociation} disabled={kitPieces.length === 0 || !newPrefix.trim()}
                      className="w-full bg-[#4361EE] disabled:opacity-40 text-white text-xs font-bold rounded-xl px-3 py-2">
                      Salvar kit ({kitPieces.length} {kitPieces.length === 1 ? "peça" : "peças"})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal memória de SKU */}
      {memoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMemoryOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[84vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <div>
                <h2 className="font-bold text-[#0F1E3C]">Memória de SKU</h2>
                <p className="text-xs text-[#0F1E3C]/40 mt-0.5 max-w-[46ch]">SKU exato do anúncio → variante (ou peças do kit) já confirmados antes. Aprendida sozinha a cada separação confirmada — pula a IA na próxima vez que o mesmo SKU aparecer.</p>
              </div>
              <button onClick={() => setMemoryOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              {memoryLoading ? (
                <p className="text-xs text-[#0F1E3C]/40">Carregando…</p>
              ) : memoryEntries.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/40 text-center py-6">Nenhum SKU memorizado ainda — aparece aqui depois da primeira separação confirmada.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30">
                      <th className="text-left pb-2">SKU</th><th className="text-left pb-2">Resolve para</th>
                      <th className="text-left pb-2">Usado</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {memoryEntries.map(m => (
                      <tr key={m.id} className="border-t border-[#0F1E3C]/5 align-top">
                        <td className="py-2 pr-2">
                          <p className="font-mono text-xs bg-[#F4F6FB] rounded px-1.5 py-0.5 w-fit truncate max-w-[140px]" title={m.sku}>{m.sku}</p>
                          <div className="flex items-center gap-1 mt-1">
                            {m.isKit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#4361EE]/10 text-[#4361EE]">KIT</span>}
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
                              {m.confirmedBy === "user_edit" ? "editado na mão" : "IA"}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-2">
                          <ul className="space-y-0.5">
                            {m.items.map((it, i) => (
                              <li key={i} className="text-xs text-[#0F1E3C]">{it.productName} {it.color ? `· ${it.color}` : ""} {it.size ? `· ${it.size}` : ""}</li>
                            ))}
                          </ul>
                        </td>
                        <td className="py-2 pr-2 text-xs text-[#0F1E3C]/50 tabular-nums whitespace-nowrap">{m.timesUsed}×</td>
                        <td className="py-2 text-right"><button onClick={() => deleteMemoryEntry(m.id)} className="text-[#0F1E3C]/30 hover:text-red-500"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de vínculo — produto → cor → tamanho, igual o PDV */}
      {linkRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={closeLinkModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30 mb-1">O que o picklist diz</p>
                <p className="font-mono text-[11px] text-[#0F1E3C]/45 truncate" title={linkRow.marketplaceSku}>{linkRow.marketplaceSku || "sem SKU"}</p>
                {linkRow.variacao && <p className="text-base font-black text-[#0F1E3C] leading-tight mt-0.5">{linkRow.variacao}</p>}
                {linkRow.title && <p className="text-xs text-[#0F1E3C]/40 mt-0.5 truncate max-w-[36ch]" title={linkRow.title}>{linkRow.title}</p>}
                {linkRows.length > 1 && (
                  <p className="text-[10px] font-semibold text-[#4361EE] mt-1">+ {linkRows.length - 1} linha{linkRows.length - 1 > 1 ? "s" : ""} igual{linkRows.length - 1 > 1 ? "is" : ""} do picklist junto com essa</p>
                )}
              </div>
              <button onClick={closeLinkModal} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center flex-shrink-0"><X size={15}/></button>
            </div>

            <div className="px-5 py-3 border-b border-[#0F1E3C]/8 flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produto</p>
                {linkRow.expectedProductName && linkRow.expectedProductName !== linkProductName && (
                  <p className="text-[10px] font-semibold text-[#4361EE]">esperado: {linkRow.expectedProductName}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {productNames.map(n => (
                  <button key={n} type="button" onClick={() => setLinkProductName(n)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                      n === linkProductName ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/55 hover:border-[#4361EE]/40"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {linkColorGroups.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/40 text-center py-6">Esse produto não tem variantes ativas.</p>
              ) : linkColorGroups.map(([color, variants]) => (
                <div key={color}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-3 h-3 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)] flex-shrink-0" style={{ background: colorSwatch(color) }} />
                    <span className="text-xs font-bold text-[#0F1E3C]">{color}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {variants.map(v => {
                      const isCurrent = v.variantId === linkRow.variantId
                      return (
                        <button
                          key={v.variantId}
                          type="button"
                          onClick={() => pickVariant(v.variantId)}
                          title={v.availableStock < 0 ? `Estoque negativo: ${v.availableStock}` : v.availableStock === 0 ? "Sem estoque" : `${v.availableStock} em estoque`}
                          className={variantPickBtnClass(v, isCurrent)}
                        >
                          <span>{v.size || "U"}</span>
                          <span className={`text-[9px] font-semibold leading-none mt-0.5 ${variantPickStockClass(v, isCurrent)}`}>
                            {v.availableStock}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showPrint && result && (
        <MarketplacePrintSheet result={result} origin={origin} onDone={() => setShowPrint(false)} />
      )}

    </div>
  )
}
