"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Printer, Link2, Plus, Trash2, X, Loader2, CheckCircle2, PackageSearch } from "lucide-react"
import { fmtDateBR } from "@/lib/tz"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}

type ReviewRow = {
  id: string
  raw: string
  title: string
  marketplaceSku: string
  variantId: string | null
  productName: string | null; color: string | null; size: string | null; sku: string | null
  stock: number | null
  qty: number
  source: "regra" | "ia" | "manual" | null
  unresolved: boolean
  remember: boolean
}

type AssociationItem = { variantId: string; qty: number; productName: string; color: string; size: string }
type Association = {
  id: number; prefix: string; kind: "single" | "kit"; origin: string; createdAt: string
  productId: string | null; productName: string | null
  items?: AssociationItem[]
}

type HistoryRow = {
  id: number; number: string; origin: string; totalItems: number; totalPieces: number; createdAt: string
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
  const [kitPieces, setKitPieces] = useState<{ variantId: string; productName: string; color: string; size: string; qty: number }[]>([])
  const [kitName, setKitName] = useState("")
  const [kitColor, setKitColor] = useState("")
  const [kitSize, setKitSize] = useState("")
  const [kitQty, setKitQty] = useState(1)

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
    setProcessing(true); setUploadError(""); setProcessMsg("Lendo o arquivo…")
    try {
      const res = await fetch("/api/marketplace/parse", { method: "POST", body: payload })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? "Erro ao analisar"); return }
      setProcessMsg(`${data.matchedByRule} de ${data.totalRows} reconhecidos por regra salva — analisando o resto…`)

      const rows: ReviewRow[] = data.rows.map((r: {
        raw: string; title: string; marketplaceSku: string; variantId: string | null; productName: string | null; color: string | null
        size: string | null; sku: string | null; stock: number | null; qty: number
        source: "regra" | "ia" | null; unresolved: boolean
      }) => ({ id: newRowId(), ...r, remember: r.source === "ia" || r.unresolved }))
      setReviewRows(rows)
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
      id: newRowId(), raw: `${variant.productName} ${variant.color} ${variant.size}`, title: "", marketplaceSku: "",
      variantId: variant.variantId, productName: variant.productName, color: variant.color, size: variant.size,
      sku: variant.sku, stock: variant.availableStock, qty: Math.max(1, manualQty),
      source: "manual", unresolved: false, remember: false,
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
      color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock, source: "manual",
    } : r))
  }

  const totals = useMemo(() => {
    const items = reviewRows.length
    const pieces = reviewRows.reduce((s, r) => s + r.qty, 0)
    const pending = reviewRows.filter(r => r.unresolved).length
    return { items, pieces, pending }
  }, [reviewRows])

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
          rows: reviewRows.map(r => ({ variantId: r.variantId, qty: r.qty, source: r.source ?? "manual" })),
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
    setReviewRows([]); setResult(null); setConfirmError(""); setUploadError("")
    setPastedText(""); setShowPaste(false); setMode("upload"); setStep(1)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ── Associations modal ──
  function openAssocModal() {
    setAssocOpen(true); loadAssociations()
    setNewAssocKind("single"); setNewPrefix(""); setKitPieces([])
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
      body = { prefix: newPrefix, kind: "kit", items: kitPieces.map(p => ({ variantId: p.variantId, qty: p.qty })), origin: "manual" }
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

  // Cascata produto→cor→tamanho do formulário de peça do kit (mesmo padrão do modo manual)
  const kitEffName = productNames.includes(kitName) ? kitName : (productNames[0] ?? "")
  const kitColors = useMemo(() => [...new Set(catalog.filter(c => c.productName === kitEffName).map(c => c.color))], [catalog, kitEffName])
  const kitEffColor = kitColors.includes(kitColor) ? kitColor : (kitColors[0] ?? "")
  const kitSizes = useMemo(() => catalog.filter(c => c.productName === kitEffName && c.color === kitEffColor), [catalog, kitEffName, kitEffColor])
  const kitEffSize = kitSizes.some(v => v.size === kitSize) ? kitSize : (kitSizes[0]?.size ?? "")

  function addKitPiece() {
    const variant = catalog.find(c => c.productName === kitEffName && c.color === kitEffColor && c.size === kitEffSize)
    if (!variant) return
    setKitPieces(prev => [...prev, { variantId: variant.variantId, productName: variant.productName, color: variant.color, size: variant.size, qty: Math.max(1, kitQty) }])
  }
  function removeKitPiece(i: number) {
    setKitPieces(prev => prev.filter((_, idx) => idx !== i))
  }

  const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"

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
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {totals.items} itens na lista{totals.pending > 0 ? ` — ${totals.pending} precisa${totals.pending > 1 ? "m" : ""} de atenção antes de confirmar` : " — tudo casado com o estoque"}
                  </p>
                </div>
                <button onClick={openAssocModal} className="flex items-center gap-1.5 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C] border border-[#0F1E3C]/10 rounded-xl px-3 py-2">
                  <Link2 size={13} /> Associações salvas
                </button>
              </div>

              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30">
                      <th className="text-left px-2 pb-2">SKU original</th>
                      <th className="text-left px-2 pb-2">Mapeado para</th>
                      <th className="text-left px-2 pb-2">Qtd</th>
                      <th className="text-left px-2 pb-2">Estoque</th>
                      <th className="px-2 pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map(r => {
                      const after = r.variantId ? (r.stock ?? 0) - r.qty : null
                      const low = after !== null && after < 0
                      const originLabel = r.source === "regra" ? "via regra salva" : r.source === "ia" ? "via IA (título)" : r.source === "manual" ? "resolvido na mão" : null
                      return (
                        <tr key={r.id} className="border-t border-[#0F1E3C]/5 align-top">
                          <td className="px-2 py-2.5 max-w-[220px]">
                            <p className="font-mono text-xs text-[#0F1E3C] bg-[#F4F6FB] rounded px-1.5 py-0.5 w-fit truncate max-w-full">{r.marketplaceSku || "—"}</p>
                            {r.title && (
                              <p className="text-[11px] text-[#0F1E3C]/55 mt-1 leading-snug" title={r.title}>{r.title}</p>
                            )}
                          </td>
                          <td className="px-2 py-2.5 min-w-[200px]">
                            <select
                              value={r.variantId ?? ""}
                              onChange={e => remapRow(r.id, e.target.value)}
                              className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 ${
                                r.unresolved ? "border-red-300 text-red-600 bg-red-50" : "border-[#0F1E3C]/12 text-[#0F1E3C]"
                              }`}
                            >
                              <option value="" disabled>{r.unresolved ? "Não encontrado — escolher..." : "Selecionar..."}</option>
                              {catalog.map(c => <option key={c.variantId} value={c.variantId}>{c.productName} · {c.color} · {c.size}</option>)}
                            </select>
                            {originLabel && <p className="text-[10px] text-[#0F1E3C]/30 mt-1">{originLabel}</p>}
                            {r.variantId && r.source !== "regra" && (
                              <label className="flex items-center gap-1.5 text-[10px] text-[#0F1E3C]/50 mt-1">
                                <input type="checkbox" checked={r.remember} onChange={e => toggleRemember(r.id, e.target.checked)} />
                                Lembrar pra próxima vez
                              </label>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <input type="number" min={1} value={r.qty} onChange={e => updateQty(r.id, parseInt(e.target.value))}
                              className="w-16 text-center border border-[#0F1E3C]/12 rounded-lg py-1 text-xs tabular-nums" />
                          </td>
                          <td className="px-2 py-2.5 tabular-nums whitespace-nowrap">
                            {after === null ? (
                              <span className="text-[#0F1E3C]/25 text-xs">—</span>
                            ) : (
                              <span className={`font-bold ${low ? "text-red-600" : "text-[#0F1E3C]"}`}>{r.stock} → {after} pç</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5"><button onClick={() => removeRow(r.id)} className="text-[#0F1E3C]/30 hover:text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
                <p className="text-sm text-[#0F1E3C]/45 mt-0.5">{result.number} · Estoque descontado · {result.totalItems} itens · {result.totalPieces} peças</p>
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
                <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-[#0F1E3C]/10 text-[#0F1E3C] text-sm font-bold px-4 py-2.5 rounded-xl">
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
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Itens</p><p className="text-lg font-black text-[#0F1E3C] tabular-nums">{totals.items}</p></div>
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
                                <li key={i} className="text-xs text-[#0F1E3C]">{it.qty}× {it.productName} · {it.color} · {it.size}</li>
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
                    <input value={newPrefix} onChange={e => setNewPrefix(e.target.value)} placeholder="Prefixo do SKU do kit — ex: KIT2-CAMISETA" className={inputCls} />

                    {kitPieces.length > 0 && (
                      <div className="space-y-1">
                        {kitPieces.map((p, i) => (
                          <div key={i} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-1.5 text-xs">
                            <span className="font-semibold text-[#0F1E3C]">{p.qty}× {p.productName} · {p.color} · {p.size}</span>
                            <button onClick={() => removeKitPiece(i)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 60px auto" }}>
                      <select value={kitEffName} onChange={e => setKitName(e.target.value)} className={inputCls}>
                        {productNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select value={kitEffColor} onChange={e => setKitColor(e.target.value)} className={inputCls}>
                        {kitColors.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={kitEffSize} onChange={e => setKitSize(e.target.value)} className={inputCls}>
                        {kitSizes.map(v => <option key={v.size} value={v.size}>{v.size}</option>)}
                      </select>
                      <input type="number" min={1} value={kitQty} onChange={e => setKitQty(parseInt(e.target.value) || 1)} className={inputCls} />
                      <button onClick={addKitPiece} className="flex items-center justify-center gap-1 border border-[#0F1E3C]/12 text-[#0F1E3C] rounded-xl px-2 text-xs font-bold">
                        <Plus size={13} /> Peça
                      </button>
                    </div>

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

    </div>
  )
}
