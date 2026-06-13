"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import {
  Plus, X, ChevronRight, Check, Clock, CheckCircle2,
  Layers, Calendar, ChevronDown, ChevronUp,
  History, Pencil,
} from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"

// ─── Types ─────────────────────────────────────────────────────────────────────
type OrderStatus   = "em_andamento" | "concluida" | "em_revisao"
type CostStatus    = "pendente" | "calculado"
type GradeRow      = { color: string; size: string; qtyProduced?: number }
type MaterialLink  = {
  materialId: number; materialName: string
  entryId: number; entryNumber: string; unit: string
  totalQty: number; totalCost: number
  color: string          // product color cut from this bobina
  piecesFromEntry: number
  exhaustedHere: boolean
  entryStatus: "disponivel" | "usada" | "esgotada"
}
type OrderLog      = { at: string; text: string }
type Order = {
  id: number; number: string; productName: string
  status: OrderStatus; costStatus: CostStatus
  grade: GradeRow[]; materials: MaterialLink[]
  unitCost?: number; totalCost?: number
  logs: OrderLog[]
  createdAt: string; concludedAt?: string
}
type AvailableEntry = {
  id: number; number: string; materialId: number; materialName: string; unit: string
  totalQty: number; totalCost: number; status: "disponivel" | "usada"
  totalPiecesProduced: number
}

// ─── Types (shared) ────────────────────────────────────────────────────────────
type MockProduct = { id: string; name: string; colors: string[]; sizes: string[] }

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtR(v: number | string) { return `R$ ${Number(v).toFixed(2).replace(".", ",")}` }

const PERIOD_OPTIONS = [
  { key:"hoje", label:"Hoje",   days:0  },
  { key:"7d",   label:"7 dias", days:7  },
  { key:"15d",  label:"15 dias",days:15 },
  { key:"30d",  label:"30 dias",days:30 },
  { key:"60d",  label:"60 dias",days:60 },
  { key:"range",label:"Período",days:-1 },
]

// ─── ConcluirModal ─────────────────────────────────────────────────────────────
function ConcluirModal({ order, onClose, onSuccess }: { order: Order; onClose: () => void; onSuccess: () => void }) {
  const [produced, setProduced] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.grade.map((_,i) => [`${i}`, ""]))
  )
  // per bobina: kg/m → exhausted yes/no | unidade → deduct yes/no
  const [matStates, setMatStates] = useState<Record<number, { exhausted: boolean; deduct: boolean }>>(() =>
    Object.fromEntries(order.materials.map(m => [m.entryId, { exhausted: false, deduct: true }]))
  )

  const totalProduced = Object.values(produced).reduce((s,v) => s + (Number(v) || 0), 0)

  // Cost preview when exhausted: bobina_total ÷ (prev_pieces + this_order_pieces)
  function costPreview(mat: typeof order.materials[0]) {
    const st = matStates[mat.entryId]
    if (!st.exhausted) return null
    const total = mat.piecesFromEntry + totalProduced
    return total > 0 ? mat.totalCost / total : null
  }

  const colorGroups = useMemo(() => {
    const map = new Map<string, typeof order.grade>()
    for (const r of order.grade) {
      if (!map.has(r.color)) map.set(r.color, [])
      map.get(r.color)!.push(r)
    }
    return [...map.entries()]
  }, [order.grade])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Concluir Ordem</h3>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">{order.number} · {order.productName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Grade — qty por cor/tamanho */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-3">Quantidade produzida</p>
            <div className="space-y-4">
              {colorGroups.map(([color, rows]) => (
                <div key={color}>
                  <p className="text-xs font-bold text-[#0F1E3C]/50 mb-2">{color}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {rows.map((g, i) => {
                      const idx = order.grade.indexOf(g)
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6">
                          <span className="text-xs font-bold text-[#0F1E3C]/50 w-8">{g.size}</span>
                          <input
                            type="number" min="0" placeholder="0"
                            value={produced[`${idx}`]}
                            onChange={e => setProduced(prev => ({...prev, [`${idx}`]: e.target.value}))}
                            className="flex-1 px-2 py-1 rounded-lg border border-[#0F1E3C]/12 text-sm font-bold text-center text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                          />
                          <span className="text-[10px] text-[#0F1E3C]/35">pç</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {totalProduced > 0 && (
              <div className="flex items-center justify-between px-4 py-2 mt-3 rounded-xl bg-[#4361EE]/6 border border-[#4361EE]/15">
                <span className="text-xs text-[#0F1E3C]/50">Total produzido</span>
                <span className="text-sm font-black text-[#4361EE]">{totalProduced} pç</span>
              </div>
            )}
          </div>

          {/* Matéria prima */}
          {order.materials.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-3">Matéria prima usada</p>
              <div className="space-y-3">
                {order.materials.map(mat => {
                  const st      = matStates[mat.entryId]
                  const isUnit  = mat.unit === "unidade"
                  const preview = !isUnit ? costPreview(mat) : null
                  return (
                    <div key={mat.entryId} className={`rounded-xl border overflow-hidden ${!isUnit && st.exhausted ? "border-emerald-200" : "border-[#0F1E3C]/10"}`}>
                      <div className={`px-4 py-3 ${!isUnit && st.exhausted ? "bg-emerald-50" : "bg-[#F9FAFB]"}`}>
                        <p className="text-sm font-bold text-[#0F1E3C]">{mat.materialName} · {mat.entryNumber}</p>
                        <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                          {mat.totalQty} {mat.unit} · {fmtR(mat.totalCost)}
                          {mat.color ? ` · cor: ${mat.color}` : ""}
                          {mat.piecesFromEntry > 0 ? ` · ${mat.piecesFromEntry} pç em ordens anteriores` : ""}
                        </p>
                      </div>
                      <div className="px-4 py-3">
                        {isUnit ? (
                          // Unidade: deduzir do estoque?
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Deduzir do estoque?</p>
                            <div className="flex gap-2">
                              {([true,false] as const).map(val => (
                                <button key={String(val)} onClick={() => setMatStates(prev => ({...prev,[mat.entryId]:{...prev[mat.entryId],deduct:val}}))}
                                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all flex items-center justify-center gap-2 ${
                                    st.deduct===val
                                      ? val ? "bg-[#4361EE] text-white border-[#4361EE]" : "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                                      : "border-[#0F1E3C]/12 text-[#0F1E3C]/50"
                                  }`}>
                                  {val ? <><Check size={13}/> Sim</> : "Não"}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          // kg/m: foi totalmente esgotada?
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Bobina foi totalmente esgotada?</p>
                            <div className="flex gap-2">
                              {([true,false] as const).map(val => (
                                <button key={String(val)} onClick={() => setMatStates(prev => ({...prev,[mat.entryId]:{...prev[mat.entryId],exhausted:val}}))}
                                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all flex items-center justify-center gap-2 ${
                                    st.exhausted===val
                                      ? val ? "bg-emerald-500 text-white border-emerald-500" : "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                                      : "border-[#0F1E3C]/12 text-[#0F1E3C]/50"
                                  }`}>
                                  {val ? <><Check size={13}/> Sim, esgotou</> : "Não, ainda tem"}
                                </button>
                              ))}
                            </div>
                            {preview !== null && (
                              <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
                                <p className="text-xs text-emerald-700 font-semibold">
                                  {fmtR(mat.totalCost)} ÷ {mat.piecesFromEntry + totalProduced} pç = <strong>{fmtR(preview)}/pç</strong>
                                </p>
                                <p className="text-[10px] text-emerald-600/70 mt-0.5">Custo calculado ao concluir</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">Cancelar</button>
          <button
            disabled={totalProduced === 0}
            onClick={async () => {
              const grade = order.grade.map((g, i) => ({
                color: g.color, size: g.size, qty: Number(produced[`${i}`]) || 0,
              }))
              const materials = order.materials.map(m => ({
                entryId:   m.entryId,
                exhausted: matStates[m.entryId]?.exhausted ?? false,
              }))
              await fetch(`/api/prod-orders/${order.id}/conclude`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ grade, materials }),
              })
              onSuccess()
              onClose()
            }}
            className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            <CheckCircle2 size={14}/> Concluir Ordem
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── NovaOrdemModal ────────────────────────────────────────────────────────────
type MaterialPick = {
  materialId: number; materialName: string; unit: string
  color: string; entryId: number; entryNumber: string; totalQty: number; totalCost: number
}

function NovaOrdemModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  type Step = "grade" | "materiais"
  const [step, setStep]               = useState<Step>("grade")
  const [productId, setProductId]     = useState<string | null>(null)
  const [selectedColors, setSelectedColors] = useState<string[]>([])
  const [matPicks, setMatPicks]       = useState<MaterialPick[]>([])

  // Fetched data
  const [products,  setProducts]  = useState<MockProduct[]>([])
  const [entries,   setEntries]   = useState<AvailableEntry[]>([])

  useEffect(() => {
    fetch("/api/products").then(r => r.json()).then((data: { id:string; name:string; colors:string[]; sizes:string[] }[]) =>
      setProducts(data.filter(p => p.colors?.length && p.sizes?.length))
    ).catch(() => {})
    fetch("/api/raw-material-entries?status=disponivel,usada").then(r => r.json()).then(
      (data: AvailableEntry[]) => setEntries(data)
    ).catch(() => {})
  }, [])

  const product     = products.find(p => p.id === productId) ?? null
  const gradeValid  = !!product && selectedColors.length > 0
  const stepOrder: Step[] = ["grade","materiais"]
  const stepIdx = stepOrder.indexOf(step)

  function toggleColor(c: string) {
    setSelectedColors(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  function toggleEntry(entry: AvailableEntry) {
    const exists = matPicks.some(p => p.entryId === entry.id)
    if (exists) {
      setMatPicks(prev => prev.filter(p => p.entryId !== entry.id))
    } else {
      setMatPicks(prev => [...prev, {
        materialId: entry.materialId, materialName: entry.materialName, unit: entry.unit,
        color: selectedColors[0] ?? "", entryId: entry.id, entryNumber: entry.number,
        totalQty: entry.totalQty, totalCost: entry.totalCost,
      }])
    }
  }

  const grouped = entries.reduce((acc, e) => {
    if (!acc[e.materialName]) acc[e.materialName] = []
    acc[e.materialName].push(e)
    return acc
  }, {} as Record<string, AvailableEntry[]>)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Nova Ordem de Produção</h3>
            <div className="flex items-center gap-1 mt-2">
              {[{key:"grade",label:"Grade"},{key:"materiais",label:"Matéria Prima"}].map(({key,label},i) => (
                <div key={key} className="flex items-center gap-1">
                  <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    i===stepIdx ? "bg-[#4361EE] text-white" : i<stepIdx ? "bg-emerald-100 text-emerald-700" : "bg-[#0F1E3C]/6 text-[#0F1E3C]/30"
                  }`}>
                    {i<stepIdx ? <Check size={9}/> : <span>{i+1}</span>} {label}
                  </div>
                  {i===0 && <div className={`w-4 h-px ${i<stepIdx ? "bg-emerald-300" : "bg-[#0F1E3C]/10"}`}/>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Grade ── */}
          {step === "grade" && (
            <div className="space-y-5">

              {/* Produto */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Produto</label>
                <select
                  value={productId ?? ""}
                  onChange={e => { setProductId(e.target.value || null); setSelectedColors([]) }}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20">
                  <option value="">Selecione o produto...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Cores */}
              {product && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">
                    Cores a produzir
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {product.colors.map(c => {
                      const active = selectedColors.includes(c)
                      return (
                        <button key={c} onClick={() => toggleColor(c)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all ${
                            active
                              ? "bg-[#4361EE] text-white border-[#4361EE]"
                              : "border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:border-[#4361EE]/40"
                          }`}>
                          {active && <Check size={11}/>}
                          {c}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Resumo grade */}
              {product && selectedColors.length > 0 && (
                <div className="px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Grade gerada</p>
                  <div className="space-y-1.5">
                    {selectedColors.map(c => (
                      <div key={c} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#0F1E3C] w-24">{c}</span>
                        <div className="flex flex-wrap gap-1">
                          {product.sizes.map(s => (
                            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[#4361EE]/8 text-[#4361EE] font-bold">{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#0F1E3C]/30 mt-2">
                    {selectedColors.length * product.sizes.length} variações · quantidades preenchidas ao concluir
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Matéria Prima ── */}
          {step === "materiais" && (
            <div className="space-y-4">
              <p className="text-xs text-[#0F1E3C]/40">Selecione as bobinas/lotes usados nessa ordem</p>

              {Object.keys(grouped).length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-[#0F1E3C]/25">
                  <Layers size={22}/>
                  <p className="text-xs font-semibold">Nenhuma matéria prima disponível</p>
                </div>
              ) : (
                Object.entries(grouped).map(([matName, matEntries]) => (
                  <div key={matName}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">{matName}</p>
                    <div className="space-y-1.5">
                      {matEntries.map(entry => {
                        const selected = matPicks.some(p => p.entryId === entry.id)
                        return (
                          <button key={entry.id} onClick={() => toggleEntry(entry)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                              selected ? "border-[#4361EE]/30 bg-[#4361EE]/5" : "border-[#0F1E3C]/8 hover:bg-[#F9FAFB]"
                            }`}>
                            <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                              selected ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/20"
                            }`}>
                              {selected && <Check size={10} className="text-white" strokeWidth={3}/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[#0F1E3C]">{entry.number}</p>
                              <p className="text-xs text-[#0F1E3C]/40">
                                {entry.totalQty} {entry.unit} · {fmtR(entry.totalCost)}
                                {entry.totalPiecesProduced > 0 ? ` · ${entry.totalPiecesProduced} pç já produzidas` : ""}
                              </p>
                            </div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                              entry.status === "disponivel" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}>{entry.status === "disponivel" ? "DISPONÍVEL" : "EM USO"}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}

              {matPicks.length > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#4361EE]/6 border border-[#4361EE]/15">
                  <span className="text-xs text-[#0F1E3C]/50">{matPicks.length} {matPicks.length === 1 ? "bobina selecionada" : "bobinas selecionadas"}</span>
                  <span className="text-sm font-black text-[#4361EE]">{fmtR(matPicks.reduce((s,m) => s + Number(m.totalCost), 0))}</span>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0 bg-[#F9FAFB]">
          <button onClick={() => { if (stepIdx===0) onClose(); else setStep(stepOrder[stepIdx-1]) }}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors">
            {stepIdx===0 ? "Cancelar" : "Voltar"}
          </button>
          <div className="flex gap-2">
            {step==="materiais" && (
              <button onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/4 transition-colors">
                Salvar rascunho
              </button>
            )}
            <button
              disabled={step==="grade" && !gradeValid}
              onClick={async () => {
                if (stepIdx < stepOrder.length - 1) {
                  setStep(stepOrder[stepIdx + 1])
                } else {
                  // Create order via API
                  await fetch("/api/prod-orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      productId,
                      selectedColors,
                      entryIds: matPicks.map(m => m.entryId),
                    }),
                  })
                  onSuccess()
                  onClose()
                }
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors">
              {stepIdx===stepOrder.length-1 ? <><Check size={14}/> Criar Ordem</> : <>Continuar <ChevronRight size={14}/></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── OrderBlock ────────────────────────────────────────────────────────────────
function OrderBlock({ order, onConcluir }: { order: Order; onConcluir: () => void }) {
  const [showLogs, setShowLogs] = useState(false)

  const colorGroups = useMemo(()=>{
    const map = new Map<string,GradeRow[]>()
    for (const r of order.grade) {
      if (!map.has(r.color)) map.set(r.color,[])
      map.get(r.color)!.push(r)
    }
    return [...map.entries()]
  },[order.grade])

  const totalProduced = order.grade.reduce((s,r)=>s+(r.qtyProduced??0),0)
  const isAndamento   = order.status==="em_andamento"

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${
      isAndamento ? "border-amber-200" : order.costStatus==="calculado" ? "border-emerald-200" : "border-[#0F1E3C]/8"
    }`}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isAndamento ? "bg-amber-400" : order.costStatus==="calculado" ? "bg-emerald-500" : "bg-[#0F1E3C]/20"}`}/>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-[#0F1E3C]">{order.productName}</p>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                isAndamento ? "bg-amber-100 text-amber-700" :
                order.costStatus==="calculado" ? "bg-emerald-100 text-emerald-700" :
                "bg-[#0F1E3C]/6 text-[#0F1E3C]/40"
              }`}>
                {isAndamento ? "EM ANDAMENTO" : order.costStatus==="calculado" ? "CONCLUÍDA ✓" : "CONCLUÍDA · CUSTO PENDENTE"}
              </span>
            </div>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {order.number} · {new Date(order.createdAt).toLocaleDateString("pt-BR")}
              {order.concludedAt ? ` → ${new Date(order.concludedAt).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowLogs(v=>!v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#0F1E3C]/10 text-[#0F1E3C]/40 hover:bg-[#0F1E3C]/4 transition-colors">
            <History size={12}/> Log
          </button>
          {isAndamento && (
            <>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#0F1E3C]/10 text-[#0F1E3C]/40 hover:bg-[#0F1E3C]/4 transition-colors">
                <Pencil size={12}/> Editar
              </button>
              <button onClick={onConcluir}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-colors">
                <CheckCircle2 size={13}/> Concluir
              </button>
            </>
          )}
        </div>
      </div>

      {/* Log */}
      {showLogs && (
        <div className="mx-5 mb-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6 overflow-hidden">
          {order.logs.map((log,i) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-2.5 ${i>0 ? "border-t border-[#0F1E3C]/5" : ""}`}>
              <span className="text-[10px] text-[#0F1E3C]/35 flex-shrink-0 mt-0.5">{log.at}</span>
              <span className="text-xs text-[#0F1E3C]/60">{log.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="grid grid-cols-2 gap-0 border-t border-[#0F1E3C]/6">

        {/* Grade */}
        <div className="px-5 py-4 border-r border-[#0F1E3C]/6">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Grade</p>
          <div className="space-y-2">
            {colorGroups.map(([color,rows]) => (
              <div key={color}>
                <p className="text-[10px] font-bold text-[#0F1E3C]/45 mb-1">{color}</p>
                <div className="flex flex-wrap gap-1">
                  {rows.map(r => (
                    <span key={r.size} className="text-xs rounded-lg px-2 py-0.5 font-semibold border bg-[#F4F6FB] border-[#0F1E3C]/8 text-[#0F1E3C]/70">
                      {r.size}{r.qtyProduced !== undefined ? `×${r.qtyProduced}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {totalProduced > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[#0F1E3C]/40">Total produzido:</span>
              <span className="text-sm font-black text-[#0F1E3C]">{totalProduced} pç</span>
            </div>
          )}
        </div>

        {/* Materials + cost */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Matéria Prima</p>
          <div className="space-y-1.5 mb-3">
            {order.materials.map(mat => (
              <div key={`${mat.entryId}-${mat.color}`} className="flex items-center gap-2">
                <Layers size={11} className="text-[#4361EE] flex-shrink-0"/>
                <span className="text-xs text-[#0F1E3C]/70 truncate">{mat.materialName}</span>
                <span className="text-[10px] text-[#0F1E3C]/35">cor: {mat.color}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0 ${
                  mat.entryStatus==="esgotada" ? "bg-[#0F1E3C]/6 text-[#0F1E3C]/30" :
                  mat.entryStatus==="usada"    ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  {mat.entryStatus==="esgotada" ? "ESGOTADA" : mat.entryStatus==="usada" ? "EM USO" : "DISPONÍVEL"}
                </span>
              </div>
            ))}
          </div>

          {order.status==="concluida" && (
            order.costStatus==="calculado" ? (
              <div className="px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-[10px] font-bold text-emerald-700 mb-1 flex items-center gap-1"><Check size={10}/> CUSTO CALCULADO</p>
                <p className="text-lg font-black text-emerald-700">{fmtR(order.unitCost!)}<span className="text-xs font-normal">/pç</span></p>
                <p className="text-[10px] text-emerald-600/70">Total: {fmtR(order.totalCost!)}</p>
              </div>
            ) : (
              <div className="px-3 py-2.5 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/8">
                <p className="text-[10px] font-bold text-[#0F1E3C]/35 mb-1 flex items-center gap-1"><Clock size={10}/> CUSTO PENDENTE</p>
                <p className="text-xs text-[#0F1E3C]/35">Aguarda esgotamento das bobinas</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── HistoryRow (concluded orders — compact clickable line) ───────────────────
function HistoryRow({ order }: { order: Order }) {
  const [open, setOpen] = useState(false)

  const colorGroups = useMemo(() => {
    const map = new Map<string, GradeRow[]>()
    for (const r of order.grade) {
      if (!map.has(r.color)) map.set(r.color, [])
      map.get(r.color)!.push(r)
    }
    return [...map.entries()]
  }, [order.grade])

  const totalProduced = order.grade.reduce((s, r) => s + (r.qtyProduced ?? 0), 0)

  return (
    <div className="bg-white rounded-xl border border-[#0F1E3C]/8 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[#F9FAFB] transition-colors text-left"
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          order.costStatus === "calculado" ? "bg-emerald-500" : "bg-[#0F1E3C]/20"
        }`}/>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#0F1E3C]">{order.productName}</span>
            <span className="text-[10px] text-[#0F1E3C]/35">{order.number}</span>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              order.costStatus === "calculado"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-[#0F1E3C]/6 text-[#0F1E3C]/40"
            }`}>
              {order.costStatus === "calculado" ? "CUSTO ✓" : "CUSTO PENDENTE"}
            </span>
          </div>
          <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
            {order.concludedAt ? new Date(order.concludedAt).toLocaleDateString("pt-BR") : "—"} · {totalProduced} pç
          </p>
        </div>

        <div className="text-right flex-shrink-0 mr-2">
          {order.costStatus === "calculado" && order.unitCost ? (
            <p className="text-sm font-black text-[#4361EE]">
              {fmtR(order.unitCost)}<span className="text-xs font-normal text-[#0F1E3C]/40">/pç</span>
            </p>
          ) : (
            <span className="text-xs text-[#0F1E3C]/30 flex items-center gap-1">
              <Clock size={11}/> pendente
            </span>
          )}
        </div>

        {open
          ? <ChevronUp size={14} className="text-[#0F1E3C]/30 flex-shrink-0"/>
          : <ChevronDown size={14} className="text-[#0F1E3C]/30 flex-shrink-0"/>
        }
      </button>

      {open && (
        <div className="px-5 py-4 bg-[#F9FAFB] border-t border-[#0F1E3C]/5">
          <div className="grid grid-cols-2 gap-5">
            {/* Grade */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Grade</p>
              <div className="space-y-2">
                {colorGroups.map(([color, rows]) => (
                  <div key={color}>
                    <p className="text-[10px] font-semibold text-[#0F1E3C]/40 mb-1">{color}</p>
                    <div className="flex flex-wrap gap-1">
                      {rows.map(r => (
                        <span key={r.size} className="text-xs rounded-lg px-2 py-0.5 font-semibold border bg-white border-[#0F1E3C]/8 text-[#0F1E3C]/70">
                          {r.size}{r.qtyProduced !== undefined ? `×${r.qtyProduced}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Materials + logs */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Matéria Prima</p>
              <div className="space-y-1.5 mb-3">
                {order.materials.map(mat => (
                  <div key={`${mat.entryId}-${mat.color}`} className="flex items-center gap-2">
                    <Layers size={11} className="text-[#4361EE] flex-shrink-0"/>
                    <span className="text-xs text-[#0F1E3C]/60 truncate">{mat.materialName} · {mat.entryNumber}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0 ${
                      mat.entryStatus === "esgotada" ? "bg-[#0F1E3C]/6 text-[#0F1E3C]/30" : "bg-amber-100 text-amber-700"
                    }`}>
                      {mat.entryStatus === "esgotada" ? "ESGOTADA" : "EM USO"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5">Log</p>
              <div className="space-y-1">
                {order.logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[10px] text-[#0F1E3C]/30 flex-shrink-0 mt-0.5">{log.at}</span>
                    <span className="text-[10px] text-[#0F1E3C]/55">{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function ProgramacaoPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showNova, setShowNova]   = useState(false)
  const [concluding, setConcluding] = useState<Order | null>(null)

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/prod-orders")
      if (res.ok) setOrders(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])
  const [period, setPeriod]       = useState("30d")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd]   = useState("")
  const [showRange, setShowRange] = useState(false)

  const active    = orders.filter(o => o.status === "em_andamento")
  const concluded = useMemo(() => {
    const done = orders.filter(o => o.status === "concluida")
    if (period === "range") {
      return done.filter(o => {
        if (!o.concludedAt) return false
        const d = o.concludedAt
        if (rangeStart && d < rangeStart) return false
        if (rangeEnd   && d > rangeEnd)   return false
        return true
      })
    }
    if (period === "hoje") {
      const today = todayBR()
      return done.filter(o => o.concludedAt === today)
    }
    const days = { "7d":7,"15d":15,"30d":30,"60d":60 }[period] ?? 30
    const cutoff = subDaysBR(days)
    return done.filter(o => o.concludedAt && o.concludedAt >= cutoff)
  }, [orders, period, rangeStart, rangeEnd])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Programação de Produção</h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-1">Ordens vinculadas a matéria prima · custo calculado por bobina</p>
        </div>
        <button onClick={()=>setShowNova(true)}
          className="flex items-center gap-2 mt-1 px-4 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] transition-colors">
          <Plus size={14}/> Nova Ordem
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-[#0F1E3C]/6">
          {[
            { label:"Em andamento",   value: active.length,     color:"text-amber-600"   },
            { label:"Concluídas",     value: orders.filter(o=>o.status==="concluida").length, color:"text-emerald-600" },
            { label:"Custo pendente", value: orders.filter(o=>o.costStatus==="pendente"&&o.status==="concluida").length, color:"text-[#0F1E3C]/50" },
            { label:"Variações ativas", value: active.reduce((s,o)=>s+o.grade.length,0), color:"text-[#0F1E3C]" },
          ].map(s => (
            <div key={s.label} className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Active orders */}
      {active.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">Em Andamento</p>
          {active.map(o => <OrderBlock key={o.id} order={o} onConcluir={()=>setConcluding(o)}/>)}
        </div>
      )}

      {/* History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">Histórico</p>
          <div className="flex items-center gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.key}
                onClick={()=>{ setPeriod(opt.key); if(opt.key==="range") setShowRange(true); else setShowRange(false) }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                  period===opt.key ? "bg-[#4361EE] text-white" : "text-[#0F1E3C]/45 hover:bg-[#0F1E3C]/6"
                }`}>
                {opt.key==="range" && <Calendar size={11}/>}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {showRange && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#4361EE]/20">
            <Calendar size={14} className="text-[#4361EE]"/>
            <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}
              className="border border-[#0F1E3C]/12 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
            <span className="text-xs text-[#0F1E3C]/40">até</span>
            <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)}
              className="border border-[#0F1E3C]/12 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
          </div>
        )}

        {concluded.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2 text-[#0F1E3C]/20">
            <History size={28} strokeWidth={1.5}/>
            <p className="text-sm">Nenhuma ordem concluída neste período</p>
          </div>
        ) : (
          <div className="space-y-2">
            {concluded.map(o => <HistoryRow key={o.id} order={o}/>)}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNova   && <NovaOrdemModal  onClose={()=>setShowNova(false)} onSuccess={loadOrders}/>}
      {concluding && <ConcluirModal  order={concluding} onClose={()=>setConcluding(null)} onSuccess={loadOrders}/>}
    </div>
  )
}
