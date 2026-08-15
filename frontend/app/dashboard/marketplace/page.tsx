"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Printer, Plus, Trash2, Loader2, CheckCircle2, PackageSearch, History, Ban, Pencil, Check, X } from "lucide-react"
import { fmtDateBR } from "@/lib/tz"
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
type FlatGroup = { isKit: boolean; cor: string; tamanho: string; qty: number; anuncios: number }
type SourceSummary = { pedidos: number | null; totalItens: number | null } | null

// "Lançar manual" — cada linha já é uma escolha real de produto/cor/tamanho,
// vira baixa de estoque de verdade ao confirmar.
type ManualRow = {
  id: string; variantId: string; productName: string; color: string; size: string
  sku: string; stock: number; qty: number
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
  const [mode, setMode] = useState<"ler" | "manual">("ler")
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

  async function runParse(payload: FormData) {
    setProcessing(true); setUploadError(""); setProcessMsg("Lendo o arquivo…")
    try {
      const res = await fetch("/api/marketplace/parse", { method: "POST", body: payload })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? "Erro ao analisar"); return }
      setGroups(data.groups); setSourceSummary(data.sourceSummary ?? null); setReadFilename(data.filename ?? "")
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
    setGroups(null); setSourceSummary(null); setReadFilename(""); setUploadError("")
    setPastedText(""); setShowPaste(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const groupsTotals = useMemo(() => {
    if (!groups) return { combinacoes: 0, pecas: 0 }
    const combinacoes = groups.length
    const pecas = groups.reduce((s, g) => s + g.qty, 0)
    return { combinacoes, pecas }
  }, [groups])

  // ── "Lançar manual" — cada linha é uma baixa real, confirmar desconta estoque ──
  const [manualRows, setManualRows] = useState<ManualRow[]>([])
  const [manualName, setManualName] = useState("")
  const [manualColor, setManualColor] = useState("")
  const [manualSize, setManualSize] = useState("")
  const [manualQty, setManualQty] = useState(1)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState("")
  const [result, setResult] = useState<{ number: string; totalItems: number; totalPieces: number; items: { productName: string; color: string; size: string; sku: string; qty: number }[] } | null>(null)
  const [showResultPrint, setShowResultPrint] = useState(false)

  const effName = productNames.includes(manualName) ? manualName : (productNames[0] ?? "")
  const manualColors = useMemo(() => [...new Set(catalog.filter(c => c.productName === effName).map(c => c.color))], [catalog, effName])
  const effColor = manualColors.includes(manualColor) ? manualColor : (manualColors[0] ?? "")
  const manualSizes = useMemo(() => catalog.filter(c => c.productName === effName && c.color === effColor), [catalog, effName, effColor])
  const effSize = manualSizes.some(v => v.size === manualSize) ? manualSize : (manualSizes[0]?.size ?? "")

  function addManualRow() {
    const variant = catalog.find(c => c.productName === effName && c.color === effColor && c.size === effSize)
    if (!variant) return
    setManualRows(prev => [...prev, {
      id: newRowId(), variantId: variant.variantId, productName: variant.productName,
      color: variant.color, size: variant.size, sku: variant.sku, stock: variant.availableStock, qty: Math.max(1, manualQty),
    }])
  }
  function updateManualQty(id: string, qty: number) {
    setManualRows(prev => prev.map(r => r.id === id ? { ...r, qty: Math.max(1, qty || 1) } : r))
  }
  function removeManualRow(id: string) {
    setManualRows(prev => prev.filter(r => r.id !== id))
  }

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
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Separação · Marketplace</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
          Lê o picklist do Shopee/ML (CSV, TXT ou PDF), organiza por produto e imprime — sem mexer no estoque. Pra baixar de verdade, usa "Lançar manual".
        </p>
      </div>

      {/* Tabs principais */}
      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold bg-white w-fit">
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
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/6">
                <button onClick={() => setMode("ler")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === "ler" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Ler picklist</button>
                <button onClick={() => setMode("manual")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === "manual" ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45"}`}>Lançar manual</button>
              </div>
              {mode === "manual" && (
                <select value={origin} onChange={e => setOrigin(e.target.value as Origin)} className={`${inputCls} !w-auto text-xs font-semibold`}>
                  {(Object.keys(ORIGIN_LABEL) as Origin[]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
                </select>
              )}
            </div>

            {/* ── Modo: Ler picklist ── */}
            {mode === "ler" && (
              <div>
                {!groups ? (
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
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                      <div>
                        {sourceSummary && (sourceSummary.pedidos != null || sourceSummary.totalItens != null) && (
                          <p className="text-[11px] text-[#0F1E3C]/35">
                            O arquivo diz:{sourceSummary.pedidos != null ? ` ${sourceSummary.pedidos} pedidos` : ""}{sourceSummary.totalItens != null ? `, ${sourceSummary.totalItens} itens no total` : ""}
                          </p>
                        )}
                        <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{groupsTotals.combinacoes} combinações de cor/tamanho, {groupsTotals.pecas} peças pra separar</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setShowBlocksPrint(true); printWhenReady() }} className="flex items-center gap-1.5 bg-[#4361EE] text-white text-xs font-bold px-3 py-2 rounded-xl">
                          <Printer size={13} /> Imprimir lista
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
                            {items.map((g, i) => (
                              <div key={i} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                                <span className="font-semibold text-[#0F1E3C]">{g.cor || "—"}{g.tamanho ? ` · ${g.tamanho}` : ""}</span>
                                <div className="flex items-center gap-2">
                                  {g.anuncios > 1 && <span className="text-[10px] text-[#0F1E3C]/35">{g.anuncios} anúncios</span>}
                                  <span className="font-bold text-[#0F1E3C] tabular-nums">× {g.qty}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Modo: Lançar manual ── */}
            {mode === "manual" && (
              <div>
                {!result ? (
                  <div>
                    <div className="bg-[#F4F6FB] rounded-xl px-4 py-2.5 text-xs text-[#0F1E3C]/50 mb-4">
                      Escolhe produto, cor e tamanho pra cada peça separada — confirmar desconta o estoque de verdade.
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

                    {manualRows.length > 0 && (
                      <div className="mt-4 space-y-1.5">
                        {manualRows.map(r => {
                          const after = r.stock - r.qty
                          const low = after < 0
                          return (
                            <div key={r.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center gap-2">
                                <span className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${low ? "bg-red-500" : "bg-emerald-500"}`} title={low ? "Estoque baixo — vai ficar negativo" : "Tem estoque"} />
                                <span className="font-semibold text-[#0F1E3C]">{r.productName} · {r.color} · {r.size}</span>
                              </div>
                              <div className="flex items-center gap-2">
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
            )}
          </div>

          {mode === "manual" && !result && (
            <div className="flex items-center justify-between gap-4 flex-wrap px-6 py-4 bg-[#F4F6FB] border-t border-[#0F1E3C]/8">
              <div className="flex gap-6">
                <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Produtos</p><p className="text-lg font-black text-[#0F1E3C] tabular-nums">{manualTotals.produtos}</p></div>
                <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Peças</p><p className="text-lg font-black text-[#0F1E3C] tabular-nums">{manualTotals.pecas} pç</p></div>
              </div>
              <button onClick={confirmSeparation} disabled={manualRows.length === 0 || confirming}
                className="bg-[#4361EE] disabled:opacity-40 text-white text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5">
                {confirming && <Loader2 size={14} className="animate-spin" />} Confirmar separação
              </button>
            </div>
          )}
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
