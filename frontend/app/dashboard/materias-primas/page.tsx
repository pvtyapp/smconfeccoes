"use client"

import { useState, useCallback, useEffect } from "react"
import {
  Plus, X, Check, Layers, ChevronDown, ChevronUp,
  Package, ChevronRight, AlertCircle, Info, Pencil, Trash2, Calendar,
} from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────
type Unit      = "kg" | "m" | "unidade"
type LotStatus = "disponivel" | "usada" | "esgotada"

type Lot = { id: number; qty: number; price: number; status: LotStatus; createdAt: string }

type InsumoVariante = {
  id: number; raizId: number; name: string
  autoDestock: boolean; minQty: number | null
  lots: Lot[]
}

type InsumoRaiz = {
  id: number; name: string; unit: Unit; autoDestock: boolean
  variantes: InsumoVariante[]
}

type PeriodoKey = "hoje" | "7d" | "30d" | "60d" | "range"

type EntradaHistorico = {
  id: number; date: string
  insumoName: string; varianteName: string; unit: Unit
  qty: number; price: number
}

type SaidaHistorico = {
  id: number; date: string
  ordemId: number; produtoName: string
  insumoName: string; varianteName: string; unit: Unit
  qtyUsed: number; pctBobina: number
  pricePer: number; pecas: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<LotStatus, { label: string; bg: string; text: string }> = {
  disponivel: { label:"NOVA",     bg:"bg-emerald-100", text:"text-emerald-700"  },
  usada:      { label:"EM USO",   bg:"bg-amber-100",   text:"text-amber-700"    },
  esgotada:   { label:"ESGOTADA", bg:"bg-[#0F1E3C]/6", text:"text-[#0F1E3C]/35" },
}

function fmtR(v: number | string)  { return `R$ ${Number(v).toFixed(2).replace(".", ",")}` }
function uls(u: Unit)      { return u === "kg" ? "kg" : u === "m" ? "metro" : "und" }
function unitStep(u: Unit) { return u === "unidade" ? "1" : "0.001" }
function fmtQty(v: number, u: Unit) {
  if (u === "unidade") return String(Math.round(v))
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function activeLots(v: InsumoVariante) { return v.lots.filter(l => l.status !== "esgotada") }
function activeQty(v: InsumoVariante)  { return activeLots(v).reduce((s, l) => s + Number(l.qty), 0) }

// ─── SummaryBox with hover tooltip ────────────────────────────────────────────
function SummaryBox({
  label, value, color, tooltip, onClick, isFirst, isLast,
}: {
  label: string; value: string | number; color: string
  tooltip?: React.ReactNode; onClick?: () => void
  isFirst?: boolean; isLast?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div
      className={`relative px-5 py-4 transition-colors ${onClick ? "cursor-pointer hover:bg-[#F9FAFB]" : tooltip ? "cursor-default" : ""}
        ${isFirst ? "rounded-tl-2xl rounded-bl-2xl" : ""}
        ${isLast  ? "rounded-tr-2xl rounded-br-2xl" : ""}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={onClick}
    >
      <div className="flex items-center gap-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">{label}</p>
        {tooltip && <Info size={10} className="text-[#0F1E3C]/25"/>}
      </div>
      <p className={`text-2xl font-black ${color}`}>{value}</p>

      {show && tooltip && (
        <div
          className="absolute top-full left-0 mt-1 z-30 bg-white rounded-xl shadow-xl border border-[#0F1E3C]/8 p-3 min-w-[220px]"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          {tooltip}
        </div>
      )}
    </div>
  )
}

// ─── Modal: Variações Esgotadas ────────────────────────────────────────────────
function EsgotadosModal({ insumos, onClose }: { insumos: InsumoRaiz[]; onClose: () => void }) {
  const missing = insumos.flatMap(ins =>
    ins.variantes
      .filter(v => v.lots.length > 0 && v.lots.every(l => l.status === "esgotada"))
      .map(v => ({
        insumoName: ins.name, variantName: v.name, unit: ins.unit,
        lastLot: v.lots[v.lots.length - 1], minQty: v.minQty,
      }))
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Variações Esgotadas</h3>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Itens aguardando reposição de estoque</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>
        <div className="px-4 py-4 space-y-2 max-h-80 overflow-y-auto">
          {missing.length === 0 ? (
            <div className="flex items-center gap-2 text-[#0F1E3C]/30 py-4 px-2">
              <Check size={14} className="text-emerald-500"/>
              <p className="text-sm">Nenhuma variação esgotada</p>
            </div>
          ) : (
            missing.map((e, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6">
                <div>
                  <p className="text-sm font-semibold text-[#0F1E3C]">{e.insumoName}</p>
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {e.variantName}
                    {e.lastLot ? ` · último: ${e.lastLot.qty} ${uls(e.unit)}` : ""}
                    {e.minQty  ? ` · mín: ${e.minQty} ${uls(e.unit)}` : ""}
                  </p>
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0">REPOR</span>
              </div>
            ))
          )}
        </div>
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Novo Insumo (raiz) ─────────────────────────────────────────────────
function NovoInsumoModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name,   setName]   = useState("")
  const [unit,   setUnit]   = useState<Unit>("kg")
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim() || saving) return
    setSaving(true)
    await fetch("/api/raw-materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), unit }),
    })
    onSuccess()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Novo Insumo</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Nome do insumo</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Moletom 80% Algodão"
              className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Unidade</label>
            <div className="flex gap-2">
              {(["kg","m","unidade"] as Unit[]).map(u => (
                <button key={u} onClick={() => setUnit(u)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                    unit === u ? "bg-[#4361EE] text-white border-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:border-[#4361EE]/30"
                  }`}>
                  {u === "kg" ? "Kg" : u === "m" ? "Metro" : "Unidade"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-[#0F1E3C]/35 px-1">
            Preço, quantidade, estoque mínimo e desconto automático são definidos nas variações de cor.
          </p>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-[#0F1E3C]/8">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">Cancelar</button>
          <button onClick={handleCreate} disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors">
            {saving ? "Criando…" : "Criar Insumo"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Adicionar Lote (filha) ─────────────────────────────────────────────
function AdicionarLoteModal({ raiz, onClose, onSuccess }: { raiz: InsumoRaiz; onClose: () => void; onSuccess: () => void }) {
  type Step = "select" | "fill"
  const [step,         setStep]         = useState<Step>("select")
  const [selected,     setSelected]     = useState<InsumoVariante | null>(null)
  const [isNew,        setIsNew]        = useState(false)
  const [varName,      setVarName]      = useState("")
  const [price,        setPrice]        = useState("")
  const [qty,          setQty]          = useState("")
  const [minQty,       setMinQty]       = useState("")
  const [autoDestock,  setAutoDestock]  = useState(raiz.autoDestock)
  const [autoPerPiece, setAutoPerPiece] = useState(raiz.unit === "unidade")
  const [saving,       setSaving]       = useState(false)

  const unitStr  = uls(raiz.unit)
  const qtyNum   = Number(qty)   || 0
  const pNum     = Number(price) || 0
  const total    = qtyNum * pNum
  const canSubmit = !!qty && !!price && total > 0 && (!isNew || varName.trim() !== "")

  function pickExisting(v: InsumoVariante) {
    setSelected(v)
    setIsNew(false)
    const last = v.lots[v.lots.length - 1]
    setPrice(last ? String(last.price) : "")
    setMinQty(v.minQty !== null ? String(v.minQty) : "")
    setAutoDestock(v.autoDestock)
    setAutoPerPiece(raiz.unit === "unidade")
    setStep("fill")
  }
  function pickNew() {
    setSelected(null)
    setIsNew(true)
    setPrice("")
    setStep("fill")
  }

  async function handleSubmit() {
    if (!canSubmit || saving) return
    setSaving(true)
    let variantId: number | null = selected?.id ?? null

    if (isNew) {
      const r = await fetch("/api/raw-material-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: raiz.id,
          name: varName.trim(),
          autoDestock,
          minQty: minQty ? Number(minQty) : null,
        }),
      })
      const variant = await r.json()
      variantId = variant.id
    }

    await fetch("/api/raw-material-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: raiz.id, variantId, qty: qtyNum, price: pNum }),
    })

    onSuccess()
    onClose()
  }

  const title = step === "select" ? "Adicionar Lote"
    : isNew ? "Nova Variação" : `Novo lote — ${selected?.name}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>{title}</h3>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{raiz.name} · {raiz.unit}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>

        <div className="px-6 py-5">

          {/* STEP 1: selecionar ou criar */}
          {step === "select" && (
            <div className="space-y-2">
              {raiz.variantes.length > 0 && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Variações existentes</p>
                  {raiz.variantes.map(v => {
                    const aq = activeQty(v)
                    return (
                      <button key={v.id} onClick={() => pickExisting(v)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#0F1E3C]/8 hover:border-[#4361EE]/30 hover:bg-[#4361EE]/4 text-left transition-colors">
                        <div>
                          <p className="text-sm font-semibold text-[#0F1E3C]">{v.name}</p>
                          <p className="text-[10px] text-[#0F1E3C]/40">
                            {v.lots.length} {v.lots.length === 1 ? "lote" : "lotes"}
                            {aq > 0 ? ` · ${aq} ${unitStr} ativo` : " · esgotado"}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-[#0F1E3C]/30 flex-shrink-0"/>
                      </button>
                    )
                  })}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-[#0F1E3C]/8"/>
                    <span className="text-[10px] font-semibold text-[#0F1E3C]/30">ou</span>
                    <div className="flex-1 h-px bg-[#0F1E3C]/8"/>
                  </div>
                </>
              )}
              <button onClick={pickNew}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[#4361EE]/35 text-sm text-[#4361EE] font-semibold hover:bg-[#4361EE]/4 transition-colors">
                <Plus size={14}/> Nova variação de cor
              </button>
            </div>
          )}

          {/* STEP 2: preencher */}
          {step === "fill" && (
            <div className="space-y-4">

              {isNew && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Nome da variação</label>
                  <input value={varName} onChange={e => setVarName(e.target.value)} placeholder="Ex: Cinza Mescla"
                    className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Preço por {unitStr}</label>
                  <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0,00"
                    className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">Quantidade ({unitStr})</label>
                  <input type="number" step={unitStep(raiz.unit)} min="0" value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
                    className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
              </div>

              {total > 0 && (
                <div className="flex items-baseline gap-1.5 px-4 py-3 rounded-xl bg-[#4361EE]/6 border border-[#4361EE]/15 text-sm text-[#0F1E3C]/60">
                  <span>{qty} {unitStr}</span>
                  <span className="text-[#0F1E3C]/30">×</span>
                  <span>{fmtR(pNum)}/{unitStr}</span>
                  <span className="text-[#0F1E3C]/30">=</span>
                  <span className="font-black text-[#4361EE] text-base ml-auto">{fmtR(total)}</span>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">
                  Mínimo em estoque ({raiz.unit === "unidade" ? "unidades" : "bobinas"})
                </label>
                <input type="number" step="1" min="0" value={minQty} onChange={e => setMinQty(e.target.value)} placeholder="Ex: 2"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                <p className="text-[10px] text-[#0F1E3C]/35 mt-1 px-1">Alerta aparece quando o estoque atingir ou ficar abaixo deste valor</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer" onClick={() => setAutoDestock(v => !v)}>
                <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                  autoDestock ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/20 bg-white"
                }`}>
                  {autoDestock && <Check size={10} className="text-white" strokeWidth={3}/>}
                </div>
                <span className="text-xs text-[#0F1E3C]/70 leading-relaxed">
                  Deduzir automaticamente do estoque ao concluir produção
                </span>
              </label>

              {raiz.unit === "unidade" && (
                <label className="flex items-start gap-3 cursor-pointer" onClick={() => setAutoPerPiece(v => !v)}>
                  <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                    autoPerPiece ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/20 bg-white"
                  }`}>
                    {autoPerPiece && <Check size={10} className="text-white" strokeWidth={3}/>}
                  </div>
                  <span className="text-xs text-[#0F1E3C]/70 leading-relaxed">
                    Deduzir 1 unidade por peça produzida ao mapear na ordem
                  </span>
                </label>
              )}

            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#0F1E3C]/8">
          <button
            onClick={() => step === "select" ? onClose() : setStep("select")}
            className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors"
          >
            {step === "select" ? "Cancelar" : "Voltar"}
          </button>
          {step === "fill" && (
            <button onClick={handleSubmit} disabled={!canSubmit || saving}
              className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors">
              {saving ? "Salvando…" : "Adicionar Lote"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Editar Variante ────────────────────────────────────────────────────
function EditarVarianteModal({
  raiz, variante, onClose, onRemoveStock, onDelete, onUpdateConfig,
}: {
  raiz: InsumoRaiz
  variante: InsumoVariante
  onClose: () => void
  onRemoveStock: (obs: string) => void
  onDelete: () => void
  onUpdateConfig: (minQty: number | null, autoDestock: boolean) => void
}) {
  type View = "options" | "remove-stock" | "delete-confirm" | "settings"
  const [view,        setView]        = useState<View>("options")
  const [obs,         setObs]         = useState("")
  const [cfgMinQty,   setCfgMinQty]   = useState(variante.minQty !== null ? String(variante.minQty) : "")
  const [cfgAuto,     setCfgAuto]     = useState(variante.autoDestock)

  const hasActive   = activeLots(variante).length > 0
  const activeCnt   = activeLots(variante).length
  const unitLabel   = raiz.unit === "unidade" ? "unidades" : "bobinas"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
              {view === "options"        ? "Editar Variação"  :
               view === "remove-stock"  ? "Remover Estoque"  :
               view === "settings"      ? "Configurações"    :
                                          "Confirmar Exclusão"}
            </h3>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{variante.name} · {raiz.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>

        <div className="px-6 py-5">

          {view === "options" && (
            <div className="space-y-3">
              <button
                onClick={() => setView("settings")}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#0F1E3C]/10 bg-[#F9FAFB] hover:bg-[#0F1E3C]/4 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
                  <Pencil size={14} className="text-[#4361EE]"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">Configurações</p>
                  <p className="text-[10px] text-[#0F1E3C]/45 mt-0.5">Editar mínimo de estoque e desconto automático</p>
                </div>
              </button>

              <button
                onClick={() => setView("remove-stock")}
                disabled={!hasActive}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Package size={14} className="text-amber-600"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">Remover Estoque</p>
                  <p className="text-[10px] text-[#0F1E3C]/45 mt-0.5">
                    {hasActive ? `${activeCnt} ${unitLabel} ativos serão removidos` : "Sem estoque ativo"}
                  </p>
                </div>
              </button>

              <button
                onClick={() => setView("delete-confirm")}
                disabled={hasActive}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-red-200 bg-red-50/50 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={14} className="text-red-600"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0F1E3C]">Deletar Variação</p>
                  <p className="text-[10px] text-[#0F1E3C]/45 mt-0.5">
                    {hasActive ? "Remova o estoque antes de deletar" : "Remove esta variação permanentemente"}
                  </p>
                </div>
              </button>
            </div>
          )}

          {view === "settings" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">
                  Mínimo em estoque ({unitLabel})
                </label>
                <input
                  type="number" min="0" step="1"
                  value={cfgMinQty} onChange={e => setCfgMinQty(e.target.value)}
                  placeholder="Ex: 2"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
                <p className="text-[10px] text-[#0F1E3C]/35 mt-1 px-1">Alerta quando o estoque atingir ou ficar abaixo deste valor</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer" onClick={() => setCfgAuto(v => !v)}>
                <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                  cfgAuto ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/20 bg-white"
                }`}>
                  {cfgAuto && <Check size={10} className="text-white" strokeWidth={3}/>}
                </div>
                <span className="text-xs text-[#0F1E3C]/70 leading-relaxed">Deduzir automaticamente do estoque ao concluir produção</span>
              </label>
            </div>
          )}

          {view === "remove-stock" && (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-800">{activeCnt} {unitLabel} serão removidos</p>
                <p className="text-[10px] text-amber-600 mt-0.5">Esta ação não pode ser desfeita</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1.5">
                  Motivo da remoção <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={obs} onChange={e => setObs(e.target.value)}
                  placeholder="Ex: Material com defeito, perda, erro de lançamento..."
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 resize-none"
                />
              </div>
            </div>
          )}

          {view === "delete-confirm" && (
            <div className="space-y-3">
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-sm font-semibold text-red-800">Deletar &quot;{variante.name}&quot; permanentemente?</p>
                <p className="text-[10px] text-red-600 mt-0.5">Todos os lotes esgotados e histórico serão apagados</p>
              </div>
            </div>
          )}

        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#0F1E3C]/8">
          <button
            onClick={() => view === "options" ? onClose() : setView("options")}
            className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors"
          >
            {view === "options" ? "Cancelar" : "Voltar"}
          </button>

          {view === "settings" && (
            <button
              onClick={() => { onUpdateConfig(cfgMinQty ? Number(cfgMinQty) : null, cfgAuto); onClose() }}
              className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] transition-colors"
            >
              Salvar
            </button>
          )}

          {view === "remove-stock" && (
            <button
              onClick={() => { onRemoveStock(obs); onClose() }}
              disabled={!obs.trim()}
              className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              Confirmar Remoção
            </button>
          )}

          {view === "delete-confirm" && (
            <button
              onClick={() => { onDelete(); onClose() }}
              className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors"
            >
              Deletar
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── InsumoCard ────────────────────────────────────────────────────────────────
function InsumoCard({
  insumo, onAddLote, onRemoveStock, onDeleteVariante, onUpdateConfig,
}: {
  insumo: InsumoRaiz
  onAddLote: () => void
  onRemoveStock: (varianteId: number, obs: string) => void
  onDeleteVariante: (varianteId: number) => void
  onUpdateConfig: (varianteId: number, minQty: number | null, autoDestock: boolean) => void
}) {
  const [open,            setOpen]            = useState(true)
  const [editingVariante, setEditingVariante] = useState<InsumoVariante | null>(null)
  const unitStr = uls(insumo.unit)

  const totalActiveQty = insumo.variantes.reduce((s, v) => s + activeQty(v), 0)

  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">

      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#4361EE]/8 flex items-center justify-center flex-shrink-0">
            <Layers size={16} className="text-[#4361EE]"/>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-[#0F1E3C]">{insumo.name}</p>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/45 uppercase">{unitStr}</span>
              {insumo.variantes.some(v => v.autoDestock) && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#4361EE]/8 text-[#4361EE] flex items-center gap-1">
                  <Check size={8} strokeWidth={3}/> AUTO-DESCONTO
                </span>
              )}
            </div>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {insumo.variantes.length} {insumo.variantes.length === 1 ? "variação" : "variações"}
              {totalActiveQty > 0 ? ` · ${fmtQty(totalActiveQty, insumo.unit)} ${unitStr} em estoque` : " · sem estoque ativo"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onAddLote}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#4361EE] text-white text-xs font-bold hover:bg-[#3451D1] transition-colors">
            <Plus size={12}/> Variação
          </button>
          <button onClick={() => setOpen(v => !v)}
            className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center transition-colors">
            {open ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#0F1E3C]/6 px-5 py-4">
          {insumo.variantes.length === 0 ? (
            <div className="flex items-center gap-2 text-[#0F1E3C]/25 py-2">
              <Package size={14}/>
              <p className="text-xs">Nenhuma variação — clique em &quot;+ Variação&quot; para adicionar estoque</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {insumo.variantes.map(variante => {
                const active        = activeLots(variante)
                const aq            = activeQty(variante)
                const cnt           = active.length
                const cmpQty        = insumo.unit === "unidade" ? aq : cnt
                const isLowStock    = variante.minQty !== null && cnt > 0 && cmpQty <= variante.minQty
                const isEmpty       = active.length === 0
                const hasDisponivel = active.some(l => l.status === "disponivel")
                const hasUsada      = active.some(l => l.status === "usada")
                const unitLabel     = insumo.unit === "unidade" ? "unidades" : cnt === 1 ? "bobina" : "bobinas"

                return (
                  <div key={variante.id} className={`rounded-xl border overflow-hidden ${
                    isEmpty       ? "border-[#0F1E3C]/6"  :
                    isLowStock    ? "border-red-200"      :
                    hasDisponivel ? "border-emerald-200"  :
                                    "border-amber-200"
                  }`}>
                    <div className={`px-3 py-2.5 ${
                      isEmpty       ? "bg-[#F9FAFB]"      :
                      isLowStock    ? "bg-red-50/60"      :
                      hasDisponivel ? "bg-emerald-50/60"  :
                                      "bg-amber-50/60"
                    }`}>
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-bold text-[#0F1E3C]">{variante.name}</p>
                          {isLowStock && <AlertCircle size={11} className="text-red-500 flex-shrink-0"/>}
                          {variante.autoDestock && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#4361EE]/10 text-[#4361EE] flex items-center gap-0.5 flex-shrink-0">
                              <Check size={7} strokeWidth={3}/> AUTO
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setEditingVariante(variante)}
                          className="w-5 h-5 rounded flex items-center justify-center text-[#0F1E3C]/30 hover:text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/8 transition-colors flex-shrink-0"
                        >
                          <Pencil size={10}/>
                        </button>
                      </div>

                      {isEmpty ? (
                        <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5">Sem estoque</p>
                      ) : (
                        <>
                          <p className="text-[10px] font-semibold text-[#0F1E3C]/50">
                            {insumo.unit === "unidade" ? `${aq} ${unitLabel}` : `${cnt} ${unitLabel}`}
                            {variante.minQty !== null && (
                              <span className="text-[#0F1E3C]/30"> · mín {variante.minQty}</span>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {hasDisponivel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">NOVA</span>}
                            {hasUsada      && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">EM USO</span>}
                            {isLowStock    && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">ESTOQUE BAIXO</span>}
                          </div>
                        </>
                      )}
                    </div>

                    {isEmpty ? (
                      <div className="flex items-center gap-1.5 px-3 py-3 text-[#0F1E3C]/30">
                        <Package size={12}/>
                        <p className="text-[10px]">Aguardando entrada</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-[#0F1E3C]/5">
                        {active.map(lot => {
                          const cfg = STATUS_CFG[lot.status]
                          return (
                            <div key={lot.id} className="flex items-center gap-2 px-3 py-2">
                              <span className="text-[11px] text-[#0F1E3C]/55 flex-1">1 bobina · {fmtQty(Number(lot.qty), insumo.unit)} {unitStr}</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {editingVariante && (
        <EditarVarianteModal
          raiz={insumo}
          variante={editingVariante}
          onClose={() => setEditingVariante(null)}
          onRemoveStock={obs => { onRemoveStock(editingVariante.id, obs); setEditingVariante(null) }}
          onDelete={() => { onDeleteVariante(editingVariante.id); setEditingVariante(null) }}
          onUpdateConfig={(minQty, auto) => { onUpdateConfig(editingVariante.id, minQty, auto); setEditingVariante(null) }}
        />
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function MateriasPrimasPage() {
  const [insumos,            setInsumos]            = useState<InsumoRaiz[]>([])
  const [loading,            setLoading]            = useState(true)
  const [showNovoInsumo,     setShowNovoInsumo]     = useState(false)
  const [addingTo,           setAddingTo]           = useState<InsumoRaiz | null>(null)
  const [showEsgotadosModal, setShowEsgotadosModal] = useState(false)
  const [periodo,            setPeriodo]            = useState<PeriodoKey>("30d")
  const [rangeStart,         setRangeStart]         = useState("")
  const [rangeEnd,           setRangeEnd]           = useState("")
  const [histTab,            setHistTab]            = useState<"entradas" | "saidas">("entradas")
  const [entradas,           setEntradas]           = useState<EntradaHistorico[]>([])
  const [saidas,             setSaidas]             = useState<SaidaHistorico[]>([])

  const loadInsumos = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/raw-materials")
      const data = await r.json()
      setInsumos(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistorico = useCallback(async () => {
    const [rEnt, rSai] = await Promise.all([
      fetch("/api/raw-material-entries"),
      fetch("/api/raw-material-saidas"),
    ])
    const dataEnt = await rEnt.json()
    const dataSai = await rSai.json()
    if (Array.isArray(dataEnt)) {
      setEntradas(dataEnt.map((e: Record<string, unknown>) => ({
        id:           e.id as number,
        date:         e.createdAt as string,
        insumoName:   e.materialName as string,
        varianteName: (e.varianteName as string) ?? "",
        unit:         e.unit as Unit,
        qty:          Number(e.totalQty),
        price:        Number(e.unitPrice),
      })))
    }
    if (Array.isArray(dataSai)) {
      setSaidas(dataSai.map((s: Record<string, unknown>) => ({
        id:           s.id as number,
        date:         s.date as string,
        ordemId:      s.ordemId as number,
        produtoName:  s.produtoName as string,
        insumoName:   s.insumoName as string,
        varianteName: (s.varianteName as string) ?? "",
        unit:         s.unit as Unit,
        qtyUsed:      Number(s.qtyUsed),
        pctBobina:    Number(s.pctBobina),
        pricePer:     Number(s.pricePer),
        pecas:        Number(s.pecas),
      })))
    }
  }, [])

  useEffect(() => {
    loadInsumos()
    loadHistorico()
  }, [loadInsumos, loadHistorico])

  async function handleRemoveStock(raizId: number, varianteId: number, obs: string) {
    const insumo   = insumos.find(r => r.id === raizId)
    const variante = insumo?.variantes.find(v => v.id === varianteId)
    if (!variante) return
    await Promise.all(
      activeLots(variante).map(lot =>
        fetch(`/api/raw-material-entries/${lot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "esgotada", notes: obs }),
        })
      )
    )
    loadInsumos()
  }

  async function handleDeleteVariante(raizId: number, varianteId: number) {
    void raizId
    await fetch(`/api/raw-material-variants/${varianteId}`, { method: "DELETE" })
    loadInsumos()
  }

  async function handleUpdateConfig(raizId: number, varianteId: number, minQty: number | null, autoDestock: boolean) {
    void raizId
    await fetch(`/api/raw-material-variants/${varianteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minQty, autoDestock }),
    })
    loadInsumos()
  }

  // ── Computed stats ──────────────────────────────────────────────────────────
  const totalSku = insumos.length

  const totalKg = insumos
    .filter(i => i.unit === "kg")
    .flatMap(i => i.variantes)
    .reduce((s, v) => s + activeQty(v), 0)

  const totalM = insumos
    .filter(i => i.unit === "m")
    .flatMap(i => i.variantes)
    .reduce((s, v) => s + activeQty(v), 0)

  const totalUnd = insumos
    .filter(i => i.unit === "unidade")
    .flatMap(i => i.variantes)
    .reduce((s, v) => s + activeQty(v), 0)

  const esgotadosCount = insumos.flatMap(i => i.variantes)
    .filter(v => v.lots.length > 0 && v.lots.every(l => l.status === "esgotada")).length

  // ── Tooltip content builders ─────────────────────────────────────────────────
  function kgTooltip() {
    const ins = insumos.filter(i => i.unit === "kg")
    return (
      <div className="space-y-2.5">
        {ins.map(i => {
          const vars = i.variantes.filter(v => activeQty(v) > 0)
          if (vars.length === 0) return null
          return (
            <div key={i.id}>
              <p className="text-xs font-bold text-[#0F1E3C] mb-1">{i.name}</p>
              {vars.map(v => (
                <p key={v.id} className="text-[10px] text-[#0F1E3C]/50 pl-2">
                  • {v.name}: {fmtQty(activeQty(v), "kg")} kg
                  {v.minQty !== null && activeQty(v) <= v.minQty && " ⚠️"}
                </p>
              ))}
            </div>
          )
        })}
        <div className="border-t border-[#0F1E3C]/8 pt-2">
          <p className="text-xs font-black text-[#4361EE]">Total: {fmtQty(totalKg, "kg")} kg</p>
        </div>
      </div>
    )
  }

  function mTooltip() {
    const ins = insumos.filter(i => i.unit === "m")
    return (
      <div className="space-y-2">
        {ins.map(i => {
          const vars = i.variantes.filter(v => activeQty(v) > 0)
          return (
            <div key={i.id}>
              <p className="text-xs font-bold text-[#0F1E3C] mb-1">{i.name}</p>
              {vars.map(v => (
                <p key={v.id} className="text-[10px] text-[#0F1E3C]/50 pl-2">
                  • {v.name}: {fmtQty(activeQty(v), "m")} m
                </p>
              ))}
            </div>
          )
        })}
        <div className="border-t border-[#0F1E3C]/8 pt-2">
          <p className="text-xs font-black text-[#4361EE]">Total: {fmtQty(totalM, "m")} m</p>
        </div>
      </div>
    )
  }

  function undTooltip() {
    const ins = insumos.filter(i => i.unit === "unidade")
    return (
      <div className="space-y-2">
        {ins.map(i => {
          const vars = i.variantes.filter(v => activeQty(v) > 0)
          return (
            <div key={i.id}>
              <p className="text-xs font-bold text-[#0F1E3C] mb-1">{i.name}</p>
              {vars.map(v => (
                <p key={v.id} className="text-[10px] text-[#0F1E3C]/50 pl-2">
                  • {v.name}: {fmtQty(activeQty(v), "unidade")} und
                </p>
              ))}
            </div>
          )
        })}
        <div className="border-t border-[#0F1E3C]/8 pt-2">
          <p className="text-xs font-black text-[#4361EE]">Total: {fmtQty(totalUnd, "unidade")} und</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Matéria Prima</h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-1">Insumos e variações por cor · estoque para produção</p>
        </div>
        <button onClick={() => setShowNovoInsumo(true)}
          className="flex items-center gap-2 mt-1 px-4 py-2 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/4 transition-colors">
          <Plus size={14}/> Novo Insumo
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8">
        <div className="grid grid-cols-5 divide-x divide-[#0F1E3C]/6">
          <SummaryBox label="Insumos SKU" value={totalSku}                              color="text-[#0F1E3C]"                                              isFirst />
          <SummaryBox label="Insumos Kg"  value={`${fmtQty(totalKg, "kg")} kg`}    color="text-[#4361EE]"   tooltip={totalKg  > 0 ? kgTooltip()  : undefined} />
          <SummaryBox label="Metros"      value={`${fmtQty(totalM, "m")} m`}        color={totalM  > 0 ? "text-[#4361EE]" : "text-[#0F1E3C]/25"} tooltip={totalM   > 0 ? mTooltip()   : undefined} />
          <SummaryBox label="Unidades"    value={fmtQty(totalUnd, "unidade")}       color={totalUnd > 0 ? "text-[#4361EE]" : "text-[#0F1E3C]/25"} tooltip={totalUnd > 0 ? undTooltip() : undefined} />
          <SummaryBox
            label="Esgotados"
            value={esgotadosCount}
            color={esgotadosCount > 0 ? "text-red-500" : "text-[#0F1E3C]/25"}
            onClick={esgotadosCount > 0 ? () => setShowEsgotadosModal(true) : undefined}
            isLast
          />
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-[#0F1E3C]/30">
          <p className="text-sm">Carregando insumos…</p>
        </div>
      ) : insumos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#0F1E3C]/25">
          <Package size={28}/>
          <p className="text-sm font-semibold">Nenhum insumo cadastrado</p>
          <p className="text-xs">Clique em &quot;Novo Insumo&quot; para começar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {insumos.map(insumo => (
            <InsumoCard
              key={insumo.id}
              insumo={insumo}
              onAddLote={() => setAddingTo(insumo)}
              onRemoveStock={(varId, obs) => handleRemoveStock(insumo.id, varId, obs)}
              onDeleteVariante={varId => handleDeleteVariante(insumo.id, varId)}
              onUpdateConfig={(varId, minQty, auto) => handleUpdateConfig(insumo.id, varId, minQty, auto)}
            />
          ))}
        </div>
      )}

      {/* Histórico */}
      {(() => {
        const TODAY = new Date()
        function daysAgo(n: number) { return new Date(TODAY.getTime() - n * 86400000) }
        function fmtDate(s: string) {
          return new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" }).replace(".", "")
        }
        function inPeriod(date: string) {
          const d = new Date(date + "T00:00:00")
          const todayStr = TODAY.toISOString().slice(0, 10)
          if (periodo === "hoje")  return date === todayStr
          if (periodo === "7d")    return d >= daysAgo(7)
          if (periodo === "30d")   return d >= daysAgo(30)
          if (periodo === "60d")   return d >= daysAgo(60)
          if (periodo === "range" && rangeStart && rangeEnd)
            return d >= new Date(rangeStart) && d <= new Date(rangeEnd + "T23:59:59")
          return true
        }

        const PERIODOS: { key: PeriodoKey; label: string }[] = [
          { key:"hoje", label:"Hoje" }, { key:"7d", label:"7d" },
          { key:"30d", label:"30d" },   { key:"60d", label:"60d" },
          { key:"range", label:"Período" },
        ]

        const filteredEntradas = entradas.filter(e => inPeriod(e.date)).sort((a,b) => b.date.localeCompare(a.date))
        const totalEntrada = filteredEntradas.reduce((s,e) => s + e.qty * e.price, 0)

        const saidasRaw = saidas.filter(e => inPeriod(e.date))
        const ordens = Array.from(new Map(saidasRaw.map(s => [s.ordemId, s])).values())
          .sort((a,b) => b.date.localeCompare(a.date))
        const saidasPorOrdem = (ordemId: number) => saidasRaw.filter(s => s.ordemId === ordemId)
        const totalSaida = saidasRaw.reduce((s,e) => s + e.qtyUsed * e.pricePer, 0)

        return (
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">

            <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/6">
              <div className="flex items-center gap-1 bg-[#F9FAFB] rounded-xl p-1">
                <button onClick={() => setHistTab("entradas")}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${histTab === "entradas" ? "bg-white shadow-sm text-[#0F1E3C]" : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]/60"}`}>
                  Entradas
                </button>
                <button onClick={() => setHistTab("saidas")}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${histTab === "saidas" ? "bg-white shadow-sm text-[#0F1E3C]" : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]/60"}`}>
                  Saídas
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {PERIODOS.map(p => (
                  <button key={p.key} onClick={() => setPeriodo(p.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1 ${
                      periodo === p.key ? "bg-[#4361EE] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5"
                    }`}>
                    {p.key === "range" && <Calendar size={11}/>}
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {periodo === "range" && (
              <div className="flex items-center gap-3 px-5 py-3 border-b border-[#0F1E3C]/6 bg-[#F9FAFB]">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">De</label>
                  <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Até</label>
                  <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                </div>
              </div>
            )}

            {histTab === "entradas" && (
              filteredEntradas.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#0F1E3C]/25">
                  <Package size={22}/><p className="text-xs font-semibold">Nenhuma entrada no período</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[72px_1fr_130px_96px_96px] gap-3 px-5 py-2 bg-[#F9FAFB] border-b border-[#0F1E3C]/5">
                    {["Data","Material","Quantidade","Preço/un","Total"].map(h => (
                      <p key={h} className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 last:text-right">{h}</p>
                    ))}
                  </div>
                  <div className="divide-y divide-[#0F1E3C]/5">
                    {filteredEntradas.map(e => (
                      <div key={e.id} className="grid grid-cols-[72px_1fr_130px_96px_96px] gap-3 px-5 py-3 hover:bg-[#F9FAFB] transition-colors items-center">
                        <p className="text-xs text-[#0F1E3C]/50">{fmtDate(e.date)}</p>
                        <div>
                          <p className="text-xs font-semibold text-[#0F1E3C]">{e.insumoName}</p>
                          <p className="text-[10px] text-[#0F1E3C]/40">{e.varianteName}</p>
                        </div>
                        <p className="text-xs text-[#0F1E3C]/70">
                          {e.unit === "unidade" ? `${e.qty} unidades` : `1 bobina · ${e.qty} ${uls(e.unit)}`}
                        </p>
                        <p className="text-xs text-[#0F1E3C]/55">{fmtR(e.price)}/{uls(e.unit)}</p>
                        <p className="text-xs font-bold text-[#0F1E3C] text-right">{fmtR(e.qty * e.price)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-5 py-3 border-t border-[#0F1E3C]/8 bg-[#F9FAFB]">
                    <p className="text-[10px] text-[#0F1E3C]/40">{filteredEntradas.length} {filteredEntradas.length === 1 ? "entrada" : "entradas"}</p>
                    <p className="text-sm font-black text-[#0F1E3C]">{fmtR(totalEntrada)}</p>
                  </div>
                </>
              )
            )}

            {histTab === "saidas" && (
              ordens.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#0F1E3C]/25">
                  <Package size={22}/><p className="text-xs font-semibold">Nenhuma saída no período</p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-[#0F1E3C]/5">
                    {ordens.map(o => {
                      const itens = saidasPorOrdem(o.ordemId)
                      const totalOrdem = itens.reduce((s,i) => s + i.qtyUsed * i.pricePer, 0)
                      const custoPorPeca = o.pecas > 0 ? totalOrdem / o.pecas : 0
                      return (
                        <div key={o.ordemId} className="px-5 py-4 hover:bg-[#F9FAFB] transition-colors">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#0F1E3C]/6 text-[#0F1E3C]/45">
                                #{o.ordemId}
                              </span>
                              <p className="text-sm font-bold text-[#0F1E3C]">{o.produtoName}</p>
                              <span className="text-[10px] text-[#0F1E3C]/40">{o.pecas} peças</span>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-[#0F1E3C]/40">{fmtDate(o.date)}</p>
                              <p className="text-xs font-bold text-[#4361EE]">{fmtR(custoPorPeca)}/pç</p>
                            </div>
                          </div>
                          <div className="space-y-1.5 pl-2">
                            {itens.map(item => {
                              const total = item.qtyUsed * item.pricePer
                              const cpPeca = item.pecas > 0 ? total / item.pecas : 0
                              return (
                                <div key={item.id} className="grid grid-cols-[1fr_110px_70px_80px_80px] gap-2 items-center">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-1 h-1 rounded-full bg-[#0F1E3C]/20 flex-shrink-0"/>
                                    <p className="text-[11px] text-[#0F1E3C]/70">{item.insumoName}</p>
                                    <p className="text-[10px] text-[#0F1E3C]/40">· {item.varianteName}</p>
                                  </div>
                                  <p className="text-[11px] text-[#0F1E3C]/55">
                                    {item.unit === "unidade" ? `${item.qtyUsed} und` : `${item.qtyUsed} ${uls(item.unit)}`}
                                  </p>
                                  <p className="text-[11px] text-[#0F1E3C]/40">
                                    {item.pctBobina.toFixed(0)}% bobina
                                  </p>
                                  <p className="text-[11px] text-[#0F1E3C]/55 text-right">{fmtR(total)}</p>
                                  <p className="text-[11px] font-semibold text-[#0F1E3C]/70 text-right">{fmtR(cpPeca)}/pç</p>
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#0F1E3C]/5">
                            <p className="text-[10px] text-[#0F1E3C]/35">Custo total de material</p>
                            <div className="flex items-center gap-3">
                              <p className="text-xs font-semibold text-[#0F1E3C]/60">{fmtR(totalOrdem)}</p>
                              <span className="text-[10px] text-[#0F1E3C]/30">·</span>
                              <p className="text-xs font-black text-[#4361EE]">{fmtR(custoPorPeca)}/pç</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between px-5 py-3 border-t border-[#0F1E3C]/8 bg-[#F9FAFB]">
                    <p className="text-[10px] text-[#0F1E3C]/40">{ordens.length} {ordens.length === 1 ? "ordem" : "ordens"} · {saidasRaw.length} materiais</p>
                    <p className="text-sm font-black text-[#0F1E3C]">{fmtR(totalSaida)}</p>
                  </div>
                </>
              )
            )}

          </div>
        )
      })()}

      {showNovoInsumo && (
        <NovoInsumoModal
          onClose={() => setShowNovoInsumo(false)}
          onSuccess={loadInsumos}
        />
      )}
      {addingTo && (
        <AdicionarLoteModal
          raiz={addingTo}
          onClose={() => setAddingTo(null)}
          onSuccess={() => { loadInsumos(); loadHistorico() }}
        />
      )}
      {showEsgotadosModal && (
        <EsgotadosModal
          insumos={insumos}
          onClose={() => setShowEsgotadosModal(false)}
        />
      )}
    </div>
  )
}
