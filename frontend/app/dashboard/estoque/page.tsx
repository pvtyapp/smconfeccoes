"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Plus, Minus, ChevronDown, ChevronRight, RefreshCw, X, Loader2, AlertTriangle, PackageOpen } from "lucide-react"
import type { BalanceRow } from "@/lib/calculations"

type Movement = {
  id: string
  variantId: string
  productName: string
  color: string
  size: string
  sku: string
  type: "in" | "out"
  quantity: number
  reason: string
  notes: string | null
  createdAt: string
}

type ModalState = {
  open: boolean
  type: "in" | "out"
  variant: BalanceRow | null
}

const ENTRY_REASONS = [
  { value: "producao",       label: "Produção" },
  { value: "entrada_manual", label: "Entrada manual" },
  { value: "devolucao",      label: "Devolução" },
  { value: "ajuste_positivo",label: "Ajuste +" },
]
const EXIT_REASONS = [
  { value: "saida_manual",   label: "Retirada manual" },
  { value: "venda_manual",   label: "Venda" },
  { value: "perda",          label: "Perda / Defeito" },
  { value: "ajuste_negativo",label: "Ajuste −" },
]

const REASON_LABEL: Record<string, string> = {
  producao: "Produção", entrada_manual: "Entrada manual", devolucao: "Devolução",
  ajuste_positivo: "Ajuste +", saida_manual: "Retirada manual", venda_manual: "Venda",
  perda: "Perda / Defeito", ajuste_negativo: "Ajuste −",
  venda: "Venda", venda_chatbot: "Venda (chatbot)",
}

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] bg-white transition-colors"

function fmtCurrency(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function stockStatus(row: BalanceRow): "zerado" | "critico" | "ok" {
  if (row.currentStock === 0) return "zerado"
  if (row.minStock > 0 && row.currentStock <= row.minStock) return "critico"
  return "ok"
}

const STATUS_CONFIG = {
  zerado:  { label: "Zerado",   cls: "bg-red-100 text-red-700" },
  critico: { label: "Crítico",  cls: "bg-orange-100 text-orange-700" },
  ok:      { label: "OK",       cls: "bg-emerald-100 text-emerald-700" },
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{label}</p>
      <p className={`text-2xl font-black mt-1 ${accent ?? "text-[#0F1E3C]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#0F1E3C]/35 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EstoquePage() {
  const [balance, setBalance]     = useState<BalanceRow[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [modal, setModal]         = useState<ModalState>({ open: false, type: "in", variant: null })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bRes, mRes] = await Promise.all([
        fetch("/api/stock/balance"),
        fetch("/api/stock/movements"),
      ])
      if (bRes.ok) setBalance(await bRes.json())
      if (mRes.ok) setMovements(await mRes.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date()
    const mo = now.getMonth(); const yr = now.getFullYear()

    const totalValue = balance.reduce((a, r) => a + r.currentStock * Number(r.salePrice), 0)
    const totalQty   = balance.reduce((a, r) => a + r.currentStock, 0)
    const critical   = balance.filter(r => stockStatus(r) !== "ok").length

    const inMonth  = movements.filter(m => {
      const d = new Date(m.createdAt)
      return m.type === "in" && d.getMonth() === mo && d.getFullYear() === yr
    }).reduce((a, m) => a + m.quantity, 0)

    const outMonth = movements.filter(m => {
      const d = new Date(m.createdAt)
      return m.type === "out" && d.getMonth() === mo && d.getFullYear() === yr
    }).reduce((a, m) => a + m.quantity, 0)

    return { totalValue, totalQty, inMonth, outMonth, critical }
  }, [balance, movements])

  // ── grouped by product ───────────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, { productName: string; rows: BalanceRow[] }>()
    for (const row of balance) {
      if (!map.has(row.productId)) map.set(row.productId, { productName: row.productName, rows: [] })
      map.get(row.productId)!.rows.push(row)
    }
    return [...map.entries()].map(([productId, g]) => ({
      productId,
      productName: g.productName,
      rows: g.rows.sort((a, b) => a.color.localeCompare(b.color) || a.size.localeCompare(b.size)),
      totalQty:   g.rows.reduce((s, r) => s + r.currentStock, 0),
      totalValue: g.rows.reduce((s, r) => s + r.currentStock * Number(r.salePrice), 0),
      hasCritical: g.rows.some(r => stockStatus(r) !== "ok"),
    }))
  }, [balance])

  function toggleExpand(productId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(productId) ? next.delete(productId) : next.add(productId)
      return next
    })
  }

  function openModal(type: "in" | "out", variant: BalanceRow | null = null) {
    setModal({ open: true, type, variant })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Estoque</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Controle de entradas e saídas por produto</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => openModal("in")}
            className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={15} /> Lançar movimentação
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Valor em estoque"  value={fmtCurrency(stats.totalValue)} sub="preço de venda" />
        <StatCard label="Peças em estoque"  value={`${stats.totalQty}`}  sub="total geral" />
        <StatCard label="Entradas no mês"   value={`+${stats.inMonth}`}  accent="text-emerald-600" />
        <StatCard label="Saídas no mês"     value={`−${stats.outMonth}`} accent="text-red-500" />
        <StatCard
          label="Crítico / Zerado"
          value={String(stats.critical)}
          accent={stats.critical > 0 ? "text-orange-600" : "text-[#0F1E3C]"}
          sub={stats.critical > 0 ? "variações abaixo do mínimo" : "tudo OK"}
        />
      </div>

      {/* Inventory by product */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <PackageOpen size={40} strokeWidth={1.2} />
          <p className="text-sm">Nenhuma variação cadastrada. Cadastre produtos com cores e tamanhos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(group => {
            const isOpen = expanded.has(group.productId)
            return (
              <div key={group.productId} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
                {/* Product header row */}
                <button
                  onClick={() => toggleExpand(group.productId)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#F4F6FB] transition-colors text-left"
                >
                  <div className={`w-1.5 h-7 rounded-full flex-shrink-0 ${group.hasCritical ? "bg-orange-400" : "bg-emerald-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#0F1E3C]">{group.productName}</p>
                    <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                      {group.rows.length} variações · {group.totalQty} peças · {fmtCurrency(group.totalValue)}
                    </p>
                  </div>
                  {group.hasCritical && (
                    <AlertTriangle size={14} className="text-orange-500 flex-shrink-0" />
                  )}
                  <div className="flex-shrink-0 text-[#0F1E3C]/30">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </button>

                {/* Variants table */}
                {isOpen && (
                  <div className="border-t border-[#0F1E3C]/6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F4F6FB] border-b border-[#0F1E3C]/6">
                          <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Cor</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Tam.</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">SKU</th>
                          <th className="text-center px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Estoque</th>
                          <th className="text-center px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Vendas 30d</th>
                          <th className="text-center px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Status</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#0F1E3C]/4">
                        {group.rows.map(row => {
                          const st = stockStatus(row)
                          const cfg = STATUS_CONFIG[st]
                          return (
                            <tr key={row.variantId} className="hover:bg-[#F4F6FB]/60 transition-colors">
                              <td className="px-5 py-3 font-medium text-[#0F1E3C]">{row.color || "—"}</td>
                              <td className="px-4 py-3 text-[#0F1E3C]/60">{row.size || "—"}</td>
                              <td className="px-4 py-3 font-mono text-xs text-[#0F1E3C]/40">{row.sku}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-base font-black ${st === "zerado" ? "text-red-600" : st === "critico" ? "text-orange-600" : "text-[#0F1E3C]"}`}>
                                  {row.currentStock}
                                </span>
                                {row.minStock > 0 && (
                                  <span className="text-[10px] text-[#0F1E3C]/30 ml-1">/ min {row.minStock}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center text-[#0F1E3C]/50 text-sm">
                                {row.salesLast30Days > 0 ? row.salesLast30Days : "—"}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                                  {cfg.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5 justify-end">
                                  <button
                                    onClick={() => openModal("in", row)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold transition-colors"
                                    title="Entrada"
                                  >
                                    <Plus size={11} /> Entrada
                                  </button>
                                  <button
                                    onClick={() => openModal("out", row)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-semibold transition-colors"
                                    title="Saída"
                                  >
                                    <Minus size={11} /> Saída
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Recent movements */}
      {movements.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Últimas movimentações</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F4F6FB] border-b border-[#0F1E3C]/5">
                {["Produto / Variação", "Tipo", "Qtd", "Motivo", "Data"].map(h => (
                  <th key={h} className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {movements.slice(0, 20).map(m => (
                <tr key={m.id} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-[#0F1E3C]">{m.productName}</p>
                    <p className="text-xs text-[#0F1E3C]/40">{[m.color, m.size, m.sku].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-5 py-2.5">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${m.type === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {m.type === "in" ? "Entrada" : "Saída"}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 font-bold text-[#0F1E3C]">{m.quantity}</td>
                  <td className="px-5 py-2.5 text-[#0F1E3C]/50 text-xs">{REASON_LABEL[m.reason] ?? m.reason}</td>
                  <td className="px-5 py-2.5 text-[#0F1E3C]/35 text-xs">
                    {new Date(m.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal.open && (
        <MovimentacaoModal
          balance={balance}
          initialType={modal.type}
          initialVariant={modal.variant}
          onClose={() => setModal({ open: false, type: "in", variant: null })}
          onSuccess={async () => {
            setModal({ open: false, type: "in", variant: null })
            await load()
          }}
        />
      )}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function MovimentacaoModal({
  balance,
  initialType,
  initialVariant,
  onClose,
  onSuccess,
}: {
  balance: BalanceRow[]
  initialType: "in" | "out"
  initialVariant: BalanceRow | null
  onClose: () => void
  onSuccess: () => Promise<void>
}) {
  const [type, setType]           = useState<"in" | "out">(initialType)
  const [productId, setProductId] = useState(initialVariant?.productId ?? "")
  const [variantId, setVariantId] = useState(initialVariant?.variantId ?? "")
  const [quantity, setQuantity]   = useState("")
  const [reason, setReason]       = useState("")
  const [notes, setNotes]         = useState("")
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  // Unique products for the first select
  const products = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of balance) map.set(r.productId, r.productName)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [balance])

  const variants = useMemo(
    () => balance.filter(r => r.productId === productId),
    [balance, productId]
  )

  const selectedVariant = balance.find(r => r.variantId === variantId) ?? null

  const reasons = type === "in" ? ENTRY_REASONS : EXIT_REASONS

  // Reset reason when type changes
  const handleTypeChange = (t: "in" | "out") => { setType(t); setReason("") }

  // Reset variant when product changes
  const handleProductChange = (id: string) => { setProductId(id); setVariantId("") }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!variantId) { setError("Selecione uma variação"); return }
    if (!reason)    { setError("Selecione um motivo");    return }

    setSaving(true); setError("")
    try {
      const res = await fetch("/api/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          type,
          quantity: Number(quantity),
          reason,
          channel: "manual",
          notes: notes || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao lançar")
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
            <h2 className="text-base font-bold text-[#0F1E3C]">Lançar movimentação</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Type toggle */}
            <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden">
              <button
                type="button"
                onClick={() => handleTypeChange("in")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${type === "in" ? "bg-emerald-600 text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4"}`}
              >
                <Plus size={14} /> Entrada
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("out")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${type === "out" ? "bg-red-600 text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4"}`}
              >
                <Minus size={14} /> Saída
              </button>
            </div>

            {/* Produto */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Produto</label>
              <select className={inputCls} value={productId} onChange={e => handleProductChange(e.target.value)} required>
                <option value="">Selecione um produto...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Variação */}
            {productId && (
              <div>
                <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Variação</label>
                <select className={inputCls} value={variantId} onChange={e => setVariantId(e.target.value)} required>
                  <option value="">Selecione...</option>
                  {variants.map(v => (
                    <option key={v.variantId} value={v.variantId}>
                      {v.color} {v.size} — est: {v.currentStock} pç
                    </option>
                  ))}
                </select>
                {selectedVariant && type === "out" && selectedVariant.currentStock === 0 && (
                  <p className="mt-1 text-xs text-red-500">⚠ Estoque zerado</p>
                )}
              </div>
            )}

            {/* Motivo */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Motivo</label>
              <select className={inputCls} value={reason} onChange={e => setReason(e.target.value)} required>
                <option value="">Selecione...</option>
                {reasons.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            {/* Quantidade */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Quantidade</label>
              <input
                className={inputCls}
                type="number"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                required
                placeholder="0"
              />
            </div>

            {/* Observação */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Observação (opcional)</label>
              <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: lote jan/2026" />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-60 ${type === "in" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Lançar {type === "in" ? "Entrada" : "Saída"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
