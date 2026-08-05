"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import {
  Plus, X, ChevronRight, Check, Clock, CheckCircle2,
  Layers, Calendar, ChevronDown, ChevronUp,
  History, Pencil, Printer, Trash2,
} from "lucide-react"
import { todayBR, subDaysBR, dateBR, fmtDateBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"
import FichaProducaoPrintSheet from "./FichaProducaoPrintSheet"
import { printWhenReady } from "@/components/print/print-utils"

// ─── Types ─────────────────────────────────────────────────────────────────────
type OrderStatus   = "em_andamento" | "concluida" | "em_revisao" | "encerrada"
type CostStatus    = "pendente" | "calculado"
type GradeRow      = { color: string; size: string; qtyPlanned: number; qtyProduced: number | null }
type MaterialLink  = {
  materialId: number; materialName: string
  entryId: number; entryNumber: string; unit: string
  totalQty: number; totalCost: number
  color: string          // product color cut from this bobina
  piecesFromEntry: number
  exhaustedHere: boolean
  entryStatus: "disponivel" | "usada" | "esgotada"
  // Ficha técnica da bobina de tecido (fluxo novo) — null pra bobina antiga/outros insumos
  tecido: string | null; tipoTecido: "aberto" | "tubular" | null; pesoKg: number | null
  gramatura: number | null; larguraM: number | null; precoKg: number | null
}
type OrderLog      = { at: string; text: string }
type Order = {
  id: number; number: string; productId: string; productName: string
  status: OrderStatus; costStatus: CostStatus
  grade: GradeRow[]; materials: MaterialLink[]
  unitCost?: number; totalCost?: number
  logs: OrderLog[]
  createdAt: string; concludedAt?: string
}
// Bobina aberta de um produto+cor — vem de /api/raw-material-entries com
// productId+color, ou openSummary=1 pro banner do topo da página.
type OpenBobina = {
  id: number; number: string
  productId: number; productName: string; color: string
  tecido: string; tipoTecido: "aberto" | "tubular"
  pesoKg: number; gramatura: number; larguraM: number; precoKg: number
  totalQty: number; unitPrice: number; totalCost: number
  status: "usada" | "disponivel"
  diasAberta: number; ordens: number; pecas: number
  activeOrderNumber: string | null
}

// ─── Types (shared) ────────────────────────────────────────────────────────────
type MockProduct = { id: string; name: string; colors: string[]; sizes: string[] }

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Um tamanho só aparece se tiver plano de corte ou produção real — combinação
// zerada (produto tem esse tamanho mas a ordem não usou) não vira chip vazio.
// qtyProduced vem NULL do banco antes de Concluir Ordem — nunca usar
// `!== undefined` aqui, `null !== undefined` é true e vazava "×null" na tela.
function gradeChipLabel(r: GradeRow): { text: string; produced: boolean } | null {
  if (r.qtyProduced != null) return { text: `${r.size}×${r.qtyProduced}`, produced: true }
  if (r.qtyPlanned > 0) return { text: `${r.size}×${r.qtyPlanned}`, produced: false }
  return null
}

// Bobina de tecido do fluxo novo mostra a ficha técnica (o que interessa de
// verdade); bobina antiga/outros insumos cai pro nome do material como sempre.
function materialLabel(mat: MaterialLink): string {
  if (mat.tecido) return `${mat.tecido} · ${mat.tipoTecido === "tubular" ? "tubular" : "aberto"}${mat.pesoKg ? ` · ${Number(mat.pesoKg).toFixed(1)}kg` : ""}`
  return mat.materialName
}

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
  // Começa com o que foi planejado na criação — chute melhor que campo vazio,
  // continua 100% editável (corte real quase sempre difere um pouco do plano).
  const [produced, setProduced] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.grade.map((g,i) => [`${i}`, g.qtyPlanned > 0 ? String(g.qtyPlanned) : ""]))
  )
  // per bobina: kg/m → exhausted yes/no/undecided | unidade → deduct yes/no
  // exhausted nasce null de propósito — força escolha explícita, não deixa
  // passar batido com um "não" implícito (isso já causou bobina fechada errado).
  const [matStates, setMatStates] = useState<Record<number, { exhausted: boolean | null; deduct: boolean }>>(() =>
    Object.fromEntries(order.materials.map(m => [m.entryId, { exhausted: null, deduct: true }]))
  )
  const [submitting, setSubmitting] = useState(false)

  const totalProduced = Object.values(produced).reduce((s,v) => s + (Number(v) || 0), 0)
  const allMaterialsAnswered = order.materials.every(m => matStates[m.entryId]?.exhausted !== null)

  // Peças produzidas só da cor dessa bobina — ordem pode ter 2+ cores/bobinas
  // e cada uma consome só a peça da SUA cor, nunca o total da ordem inteira.
  function totalProducedForColor(color: string) {
    return order.grade.reduce((s, g, i) => g.color === color ? s + (Number(produced[`${i}`]) || 0) : s, 0)
  }

  // Cost preview when exhausted: bobina_total ÷ (prev_pieces + peças dessa cor nessa ordem)
  function costPreview(mat: typeof order.materials[0]) {
    const st = matStates[mat.entryId]
    if (!st.exhausted) return null
    const total = mat.piecesFromEntry + totalProducedForColor(mat.color)
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
                          {g.qtyPlanned > 0 && <span className="text-[9px] text-[#0F1E3C]/30 flex-shrink-0">plan. {g.qtyPlanned}</span>}
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
                        <p className="text-sm font-bold text-[#0F1E3C]">{materialLabel(mat)} · {mat.entryNumber}</p>
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
                            <div className={`flex gap-2 rounded-xl transition-all ${st.exhausted===null ? "ring-2 ring-amber-300" : ""}`}>
                              {([true,false] as const).map(val => (
                                <button key={String(val)} onClick={() => setMatStates(prev => ({...prev,[mat.entryId]:{...prev[mat.entryId],exhausted:val}}))}
                                  className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                                    st.exhausted===val
                                      ? val ? "bg-emerald-500 text-white border-emerald-500" : "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                                      : "border-dashed border-[#0F1E3C]/20 text-[#0F1E3C]/40 hover:border-[#0F1E3C]/35"
                                  }`}>
                                  {val ? <><Check size={13}/> Sim, esgotou</> : "Não, ainda tem"}
                                </button>
                              ))}
                            </div>
                            {st.exhausted === null && (
                              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2 font-semibold">
                                ⚠ Escolha uma opção pra liberar "Concluir Ordem"
                              </p>
                            )}
                            {st.exhausted === true && (
                              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2">
                                Irreversível — o custo/peça desta bobina será calculado agora.
                              </p>
                            )}
                            {preview !== null && (
                              <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
                                <p className="text-xs text-emerald-700 font-semibold">
                                  {fmtR(mat.totalCost)} ÷ {mat.piecesFromEntry + totalProducedForColor(mat.color)} pç = <strong>{fmtR(preview)}/pç</strong>
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
          <button onClick={onClose} disabled={submitting} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors disabled:opacity-40">Cancelar</button>
          <button
            disabled={totalProduced === 0 || !allMaterialsAnswered || submitting}
            onClick={async () => {
              setSubmitting(true)
              try {
                const grade = order.grade.map((g, i) => ({
                  color: g.color, size: g.size, qty: Number(produced[`${i}`]) || 0,
                }))
                const materials = order.materials.map(m => ({
                  entryId:   m.entryId,
                  exhausted: matStates[m.entryId]?.exhausted ?? false,
                }))
                const res = await fetch(`/api/prod-orders/${order.id}/conclude`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ grade, materials }),
                })
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}))
                  alert(body?.error || "Falha ao concluir ordem")
                  setSubmitting(false)
                  return
                }
                onSuccess()
                onClose()
              } catch {
                alert("Falha ao concluir ordem — confere a conexão e tenta de novo")
                setSubmitting(false)
              }
            }}
            className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            <CheckCircle2 size={14}/> {submitting ? "Concluindo..." : "Concluir Ordem"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── NovaOrdemModal — bobina nasce no clique da cor ────────────────────────────
type TipoTecido = "aberto" | "tubular"

type ColorBobina =
  | {
      reuse: true
      entryId: number; tecido: string
      diasAberta: number; ordens: number; pecas: number
      sizes: Record<string, string>
      // true quando a bobina já nasceu vinculada a ESTA ordem (edição) —
      // card fica mais simples, sem estatística de "outras ordens".
      linkedNow?: boolean
    }
  | {
      reuse: false
      // Já existe uma bobina (incompleta) pra essa cor nessa ordem — edição
      // deve ATUALIZAR essa linha em vez de criar outra do zero.
      existingEntryId?: number
      tecido: string; tipoTecido: TipoTecido | null
      pesoKg: string; gramatura: string; larguraM: string; precoKg: string
      sizes: Record<string, string>
    }

function numOrNaN(v: string | undefined): number {
  if (v === undefined || v === "") return NaN
  return parseFloat(v.replace(",", "."))
}

function calcBobina(cd: Extract<ColorBobina, { reuse: false }>) {
  const peso = numOrNaN(cd.pesoKg), gram = numOrNaN(cd.gramatura), larg = numOrNaN(cd.larguraM), preco = numOrNaN(cd.precoKg)
  if (!peso || !gram || !larg) return { metros: null as number | null, custo: null as number | null }
  const larguraCorte = cd.tipoTecido === "tubular" ? larg * 2 : larg
  const metros = (peso * 1000) / (gram * larguraCorte)
  const custo = preco ? peso * preco : null
  return { metros, custo }
}

function piecesFor(cd: ColorBobina): number {
  return Object.values(cd.sizes).reduce((s, v) => s + (parseInt(v) || 0), 0)
}

function colorComplete(cd: ColorBobina): boolean {
  if (piecesFor(cd) === 0) return false
  if (cd.reuse) return true
  if (!cd.tecido || !cd.tipoTecido) return false
  return [cd.pesoKg, cd.gramatura, cd.larguraM, cd.precoKg].every(v => numOrNaN(v) > 0)
}

function NovaOrdemModal({ onClose, onSuccess, editOrder }: { onClose: () => void; onSuccess: () => void; editOrder?: Order }) {
  type Step = "produto" | "cores"
  const [step, setStep]               = useState<Step>(editOrder ? "cores" : "produto")
  const [productId, setProductId]     = useState<string | null>(editOrder?.productId ?? null)
  const [selectedColors, setSelectedColors] = useState<string[]>(() =>
    editOrder ? [...new Set(editOrder.grade.map(g => g.color))] : []
  )
  // Modo edição: reconstrói o estado da ordem já existente. Cor com bobina
  // COMPLETA vira card "reuse" simplificado (linkedNow, só leitura). Cor sem
  // bobina, ou com bobina incompleta (rascunho que não preencheu tudo), vira
  // formulário editável pré-preenchido com o que já tinha sido digitado —
  // nada do que foi salvo se perde.
  const [colorData, setColorData]     = useState<Record<string, ColorBobina>>(() => {
    if (!editOrder) return {}
    const colors = [...new Set(editOrder.grade.map(g => g.color))]
    const map: Record<string, ColorBobina> = {}
    for (const c of colors) {
      const sizes: Record<string, string> = {}
      for (const g of editOrder.grade) {
        if (g.color === c && g.qtyPlanned > 0) sizes[g.size] = String(g.qtyPlanned)
      }
      const mat = editOrder.materials.find(m => m.color === c)
      const matComplete = mat && mat.tecido && mat.tipoTecido && mat.pesoKg && mat.gramatura && mat.larguraM && mat.precoKg
      if (matComplete) {
        map[c] = { reuse: true, entryId: mat.entryId, tecido: mat.tecido!, diasAberta: 0, ordens: 0, pecas: 0, sizes, linkedNow: true }
      } else {
        map[c] = {
          reuse: false, existingEntryId: mat?.entryId,
          tecido: mat?.tecido ?? "", tipoTecido: mat?.tipoTecido ?? null,
          pesoKg: mat?.pesoKg ? String(mat.pesoKg) : "",
          gramatura: mat?.gramatura ? String(mat.gramatura) : "",
          larguraM: mat?.larguraM ? String(mat.larguraM) : "",
          precoKg: mat?.precoKg ? String(mat.precoKg) : "",
          sizes,
        }
      }
    }
    return map
  })
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const [products, setProducts] = useState<MockProduct[]>([])

  useEffect(() => {
    fetch("/api/products").then(r => r.json()).then((data: { id:string; name:string; colors:string[]; sizes:string[] }[]) =>
      setProducts(data.filter(p => p.colors?.length && p.sizes?.length))
    ).catch(() => {})
  }, [])

  const product = products.find(p => p.id === productId) ?? null
  const stepOrder: Step[] = editOrder ? ["cores"] : ["produto","cores"]
  const stepIdx = stepOrder.indexOf(step)

  async function toggleColor(c: string) {
    if (selectedColors.includes(c)) {
      setSelectedColors(prev => prev.filter(x => x !== c))
      return
    }
    setSelectedColors(prev => [...prev, c])
    if (colorData[c] || !productId) return
    try {
      const res = await fetch(`/api/raw-material-entries?productId=${productId}&color=${encodeURIComponent(c)}`)
      const rows: OpenBobina[] = res.ok ? await res.json() : []
      if (rows.length) {
        const b = rows[0]
        setColorData(prev => ({ ...prev, [c]: {
          reuse: true, entryId: b.id, tecido: b.tecido,
          diasAberta: b.diasAberta, ordens: b.ordens, pecas: b.pecas, sizes: {},
        }}))
        return
      }
    } catch {}
    setColorData(prev => ({ ...prev, [c]: {
      reuse: false, tecido: "", tipoTecido: null, pesoKg: "", gramatura: "", larguraM: "", precoKg: "", sizes: {},
    }}))
  }

  function setField(color: string, field: "tecido" | "pesoKg" | "gramatura" | "larguraM" | "precoKg", value: string) {
    setColorData(prev => {
      const cd = prev[color]
      if (!cd || cd.reuse) return prev
      return { ...prev, [color]: { ...cd, [field]: value } }
    })
  }
  function setTipo(color: string, tipo: TipoTecido) {
    setColorData(prev => {
      const cd = prev[color]
      if (!cd || cd.reuse) return prev
      return { ...prev, [color]: { ...cd, tipoTecido: tipo } }
    })
  }
  function setSize(color: string, size: string, value: string) {
    setColorData(prev => {
      const cd = prev[color]
      if (!cd) return prev
      return { ...prev, [color]: { ...cd, sizes: { ...cd.sizes, [size]: value } } }
    })
  }
  function forceNewBobina(color: string) {
    setColorData(prev => ({ ...prev, [color]: {
      reuse: false, tecido: "", tipoTecido: null, pesoKg: "", gramatura: "", larguraM: "", precoKg: "",
      sizes: prev[color]?.sizes ?? {},
    }}))
  }

  const totalPecas = selectedColors.reduce((s, c) => s + (colorData[c] ? piecesFor(colorData[c]) : 0), 0)
  const bobinaCostNovas = selectedColors.reduce((s, c) => {
    const cd = colorData[c]
    if (!cd || cd.reuse) return s
    return s + (calcBobina(cd).custo ?? 0)
  }, 0)
  const orderComplete = selectedColors.length > 0 && selectedColors.every(c => colorData[c] && colorComplete(colorData[c]))

  // strict=true (Criar Ordem): exige tudo completo, igual sempre foi.
  // strict=false (Salvar rascunho / Salvar alterações): só exige produto +
  // 1 cor — cor sem ficha técnica preenchida fica sem bobina vinculada por
  // enquanto (completa depois pelo Editar), tamanho em branco vira qtyPlanned 0.
  async function handleSave(strict: boolean) {
    if (!productId) return
    if (strict && !orderComplete) return
    if (!strict && selectedColors.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const entries: { entryId: number; color: string }[] = []
      for (const c of selectedColors) {
        const cd = colorData[c]
        if (!cd) continue
        if (cd.reuse) {
          entries.push({ entryId: cd.entryId, color: c })
          continue
        }
        // Salva SEMPRE o que foi digitado, completo ou não — só pula se a cor
        // não tem literalmente nada preenchido ainda (evita bobina vazia à toa).
        const touched = !!(cd.tecido || cd.tipoTecido || numOrNaN(cd.pesoKg) > 0 ||
          numOrNaN(cd.gramatura) > 0 || numOrNaN(cd.larguraM) > 0 || numOrNaN(cd.precoKg) > 0)
        if (!touched && !strict) continue

        const ficha = {
          tecido: cd.tecido || null, tipoTecido: cd.tipoTecido,
          pesoKg: numOrNaN(cd.pesoKg), gramatura: numOrNaN(cd.gramatura),
          larguraM: numOrNaN(cd.larguraM), precoKg: numOrNaN(cd.precoKg),
        }
        if (cd.existingEntryId) {
          const res = await fetch(`/api/raw-material-entries/${cd.existingEntryId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ficha),
          })
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Falha ao atualizar bobina")
          entries.push({ entryId: cd.existingEntryId, color: c })
        } else {
          const res = await fetch("/api/raw-material-entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, color: c, ...ficha }),
          })
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Falha ao criar bobina")
          const created = await res.json()
          entries.push({ entryId: created.entryId, color: c })
        }
      }

      const grade = selectedColors.flatMap(c => {
        const cd = colorData[c]
        if (!cd) return []
        return Object.entries(cd.sizes)
          .filter(([, v]) => (parseInt(v) || 0) > 0)
          .map(([size, v]) => ({ color: c, size, qtyPlanned: parseInt(v) || 0 }))
      })

      const url    = editOrder ? `/api/prod-orders/${editOrder.id}` : "/api/prod-orders"
      const method = editOrder ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, selectedColors, entries, grade }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Falha ao salvar ordem")

      onSuccess()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar ordem")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
          <div>
            <h3 className="font-bold text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
              {editOrder ? `Editar Ordem — ${editOrder.number}` : "Nova Ordem de Produção"}
            </h3>
            {!editOrder && (
              <div className="flex items-center gap-1 mt-2">
                {[{key:"produto",label:"Produto"},{key:"cores",label:"Cores & Bobina"}].map(({key,label},i) => (
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
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 flex items-center justify-center"><X size={15}/></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Produto ── */}
          {step === "produto" && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Produto</label>
              <div className="grid grid-cols-3 gap-2.5">
                {products.map(p => {
                  const active = p.id === productId
                  return (
                    <button key={p.id}
                      onClick={() => { setProductId(p.id); setSelectedColors([]); setColorData({}) }}
                      className={`px-3 py-4 rounded-xl border-2 text-center transition-all ${
                        active ? "border-[#4361EE] bg-[#4361EE]/5" : "border-[#0F1E3C]/10 hover:border-[#4361EE]/40"
                      }`}>
                      <p className="text-xs font-bold text-[#0F1E3C]">{p.name}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── STEP 2: Cores & Bobina ── */}
          {step === "cores" && product && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">
                  Cores — clique pra marcar (1 ou mais)
                </label>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(c => {
                    const active = selectedColors.includes(c)
                    const hasOpen = colorData[c]?.reuse
                    return (
                      <button key={c} onClick={() => toggleColor(c)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all ${
                          active ? "bg-[#4361EE] text-white border-[#4361EE]" : "border-[#0F1E3C]/15 text-[#0F1E3C]/60 hover:border-[#4361EE]/40"
                        }`}>
                        {active && <Check size={11}/>}
                        {c}
                        {hasOpen && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-1">BOBINA ABERTA</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedColors.length === 0 && (
                <p className="text-xs text-[#0F1E3C]/35">Marque ao menos uma cor acima pra continuar.</p>
              )}

              {selectedColors.map(c => {
                const cd = colorData[c]
                if (!cd) return null
                return (
                  <div key={c} className="rounded-xl border border-[#0F1E3C]/10 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F9FAFB] border-b border-[#0F1E3C]/6">
                      <p className="text-sm font-bold text-[#0F1E3C] flex-1">{c}</p>
                    </div>

                    {cd.reuse ? (
                      <div className="flex items-start gap-2.5 mx-4 mt-3 px-3.5 py-3 rounded-xl bg-amber-50 border border-amber-200">
                        <Layers size={14} className="text-amber-600 flex-shrink-0 mt-0.5"/>
                        <p className="text-xs text-[#0F1E3C]/70 leading-snug">
                          {cd.linkedNow ? (
                            <><b className="text-amber-700">Bobina já criada pra esta ordem</b> — {cd.tecido}. Ficha técnica não muda depois de criada.</>
                          ) : (
                            <>
                              <b className="text-amber-700">Bobina aberta reaproveitada</b> — {cd.tecido}, aberta há {cd.diasAberta} dia(s), {cd.ordens} ordem(ns) já usaram essa bobina ({cd.pecas} peças até agora).{" "}
                              <button onClick={() => forceNewBobina(c)} className="font-bold text-[#4361EE] hover:underline">trocar por bobina nova</button>
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="px-4 pt-3">
                        <div className="grid grid-cols-4 gap-2.5">
                          <div className="col-span-2">
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">Tecido</label>
                            <input type="text" placeholder="Digite o tecido" value={cd.tecido}
                              onChange={e => setField(c, "tecido", e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">Tipo</label>
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => setTipo(c, "aberto")}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${
                                  cd.tipoTecido === "aberto" ? "bg-[#4361EE] border-[#4361EE] text-white" : "border-[#0F1E3C]/12 text-[#0F1E3C]/50"
                                }`}>Aberto</button>
                              <button type="button" onClick={() => setTipo(c, "tubular")}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${
                                  cd.tipoTecido === "tubular" ? "bg-[#4361EE] border-[#4361EE] text-white" : "border-[#0F1E3C]/12 text-[#0F1E3C]/50"
                                }`}>Tubular</button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">Peso (kg)</label>
                            <input type="text" inputMode="decimal" placeholder="0,0" value={cd.pesoKg}
                              onChange={e => setField(c, "pesoKg", e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">Gramatura (g/m²)</label>
                            <input type="text" inputMode="decimal" placeholder="0" value={cd.gramatura}
                              onChange={e => setField(c, "gramatura", e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">
                              {cd.tipoTecido === "tubular" ? "Boca do tubo (m)" : "Largura (m)"}
                            </label>
                            <input type="text" inputMode="decimal" placeholder="0,00" value={cd.larguraM}
                              onChange={e => setField(c, "larguraM", e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">Preço/kg (R$)</label>
                            <input type="text" inputMode="decimal" placeholder="0,00" value={cd.precoKg}
                              onChange={e => setField(c, "precoKg", e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                          </div>
                        </div>

                        {cd.tipoTecido === "tubular" && (
                          <p className="text-[10px] text-[#0F1E3C]/40 mt-2">
                            Boca de {numOrNaN(cd.larguraM) || "—"} m → largura de corte ≈ {(numOrNaN(cd.larguraM) ? numOrNaN(cd.larguraM) * 2 : 0).toFixed(2)} m (tubo aberto).
                          </p>
                        )}

                        {(() => {
                          const r = calcBobina(cd)
                          const pecas = piecesFor(cd)
                          return (
                            <div className="mt-3 mb-1 px-3.5 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70 mb-0.5">Custo estimado / peça</p>
                              <p className="text-xl font-black text-emerald-700">
                                {(r.custo && pecas > 0) ? fmtR(r.custo / pecas) : "—"}
                              </p>
                              <p className="text-[10px] text-[#0F1E3C]/40 mt-1">
                                Metragem ≈ {r.metros ? `${r.metros.toFixed(1)} m` : "—"} · Bobina ≈ {r.custo ? fmtR(r.custo) : "—"}
                              </p>
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    {/* Grade de tamanhos */}
                    <div className="grid gap-2 px-4 pb-4 pt-1" style={{ gridTemplateColumns: `repeat(${product.sizes.length}, 1fr)` }}>
                      {product.sizes.map(s => (
                        <div key={s} className="text-center">
                          <p className="text-[10px] font-bold text-[#0F1E3C]/45 mb-1">{s}</p>
                          <input type="text" inputMode="numeric" placeholder="0"
                            value={cd.sizes[s] ?? ""}
                            onChange={e => setSize(c, s, e.target.value)}
                            className="w-full text-center px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-sm font-bold text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {error && <p className="text-xs font-semibold text-red-600 px-1">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-[#0F1E3C]/8 flex-shrink-0 bg-[#F9FAFB]">
          {step === "cores" && (
            <p className="text-[10px] text-[#0F1E3C]/35 leading-snug">
              {editOrder ? (
                <><b>Salvar alterações</b> grava na ordem — cor sem ficha técnica fica pendente, completa numa próxima edição.</>
              ) : (
                <><b>Salvar rascunho</b> já cria a ordem de verdade, mesmo incompleta — completa depois pelo Editar. <b>Criar Ordem</b> exige tecido, tipo, peso, gramatura, largura e preço/kg de cada bobina nova, e ao menos 1 peça em algum tamanho de cada cor.</>
              )}
            </p>
          )}
          <div className="flex items-center justify-between">
            <button onClick={() => { if (stepIdx===0) onClose(); else setStep(stepOrder[stepIdx-1]) }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors">
              {stepIdx===0 ? "Cancelar" : "Voltar"}
            </button>
            <div className="flex items-center gap-3">
              {step === "cores" && (
                <>
                  {totalPecas > 0 && (
                    <span className="text-xs text-[#0F1E3C]/45">
                      {totalPecas} pç{bobinaCostNovas > 0 ? ` · bobina(s) nova(s) ${fmtR(bobinaCostNovas)}` : ""}
                    </span>
                  )}
                  {!editOrder && (
                    <button onClick={() => handleSave(false)} disabled={selectedColors.length===0 || saving}
                      className="px-4 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/4 disabled:opacity-40 transition-colors">
                      Salvar rascunho
                    </button>
                  )}
                </>
              )}
              {editOrder ? (
                <button
                  disabled={selectedColors.length===0 || saving}
                  onClick={() => handleSave(false)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors">
                  <Check size={14}/> {saving ? "Salvando..." : "Salvar alterações"}
                </button>
              ) : (
                <button
                  disabled={(step==="produto" && !productId) || (step==="cores" && (!orderComplete || saving))}
                  onClick={() => { if (step==="produto") setStep("cores"); else handleSave(true) }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] disabled:opacity-40 transition-colors">
                  {step==="cores" ? <><Check size={14}/> {saving ? "Criando..." : "Criar Ordem"}</> : <>Continuar <ChevronRight size={14}/></>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── OrderBlock ────────────────────────────────────────────────────────────────
function OrderBlock({ order, onConcluir, onEditar, onDeletar }: {
  order: Order; onConcluir: () => void; onEditar: () => void; onDeletar: () => Promise<void>
}) {
  const [showLogs, setShowLogs] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const colorGroups = useMemo(()=>{
    const map = new Map<string,GradeRow[]>()
    for (const r of order.grade) {
      if (!map.has(r.color)) map.set(r.color,[])
      map.get(r.color)!.push(r)
    }
    return [...map.entries()]
  },[order.grade])

  const totalProduced = order.grade.reduce((s,r)=>s+(r.qtyProduced??0),0)
  const totalPlanned  = order.grade.reduce((s,r)=>s+r.qtyPlanned,0)
  const isAndamento  = order.status === "em_andamento"
  const isEncerrada  = order.status === "encerrada"

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${
      isAndamento   ? "border-amber-200"   :
      isEncerrada   ? "border-[#4361EE]/20" :
      order.costStatus==="calculado" ? "border-emerald-200" : "border-[#0F1E3C]/8"
    }`}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${
            isAndamento ? "bg-amber-400"  :
            isEncerrada ? "bg-[#4361EE]" :
            order.costStatus==="calculado" ? "bg-emerald-500" : "bg-[#0F1E3C]/20"
          }`}/>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-[#0F1E3C]">{order.productName}</p>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                isAndamento ? "bg-amber-100 text-amber-700" :
                isEncerrada ? "bg-[#4361EE]/10 text-[#4361EE]" :
                order.costStatus==="calculado" ? "bg-emerald-100 text-emerald-700" :
                "bg-[#0F1E3C]/6 text-[#0F1E3C]/40"
              }`}>
                {isAndamento ? "EM ANDAMENTO" :
                 isEncerrada ? "ENCERRADA" :
                 order.costStatus==="calculado" ? "CONCLUÍDA ✓" : "CONCLUÍDA · CUSTO PENDENTE"}
              </span>
            </div>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {order.number} · {fmtDateBR(order.createdAt)}
              {order.concludedAt ? ` → ${fmtDateBR(order.concludedAt)}` : ""}
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
              <button onClick={onEditar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#0F1E3C]/10 text-[#0F1E3C]/40 hover:bg-[#0F1E3C]/4 transition-colors">
                <Pencil size={12}/> Editar
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  if (!confirm(`Apagar a ordem ${order.number}? Isso não pode ser desfeito.`)) return
                  setDeleting(true)
                  try {
                    await onDeletar()
                  } finally {
                    setDeleting(false)
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                <Trash2 size={12}/> {deleting ? "Apagando..." : "Deletar"}
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
                  {rows.map(r => {
                    const chip = gradeChipLabel(r)
                    if (!chip) return null
                    return (
                      <span key={r.size} className={`text-xs rounded-lg px-2 py-0.5 font-semibold border ${
                        chip.produced ? "bg-[#F4F6FB] border-[#0F1E3C]/8 text-[#0F1E3C]/70" : "border-dashed border-[#0F1E3C]/15 text-[#0F1E3C]/45"
                      }`}>
                        {chip.text}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {totalProduced > 0 ? (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[#0F1E3C]/40">Total produzido:</span>
              <span className="text-sm font-black text-[#0F1E3C]">{totalProduced} pç</span>
            </div>
          ) : totalPlanned > 0 ? (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <Clock size={12} className="text-amber-600 flex-shrink-0"/>
              <span className="text-xs text-amber-700">Plano: {totalPlanned} pç · aguardando corte e conclusão</span>
            </div>
          ) : null}
        </div>

        {/* Materials + cost */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-2">Matéria Prima</p>
          <div className="space-y-1.5 mb-3">
            {order.materials.map(mat => (
              <div key={`${mat.entryId}-${mat.color}`} className="flex items-center gap-2">
                <Layers size={11} className="text-[#4361EE] flex-shrink-0"/>
                <span className="text-xs text-[#0F1E3C]/70 truncate">{materialLabel(mat)}</span>
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
            {order.concludedAt ? fmtDateBR(order.concludedAt) : "—"} · {totalProduced} pç
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
                      {rows.map(r => {
                        const chip = gradeChipLabel(r)
                        if (!chip) return null
                        return (
                          <span key={r.size} className="text-xs rounded-lg px-2 py-0.5 font-semibold border bg-white border-[#0F1E3C]/8 text-[#0F1E3C]/70">
                            {chip.text}
                          </span>
                        )
                      })}
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
                    <span className="text-xs text-[#0F1E3C]/60 truncate">{materialLabel(mat)} · {mat.entryNumber}</span>
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

// ─── BobinasAbertasBanner ───────────────────────────────────────────────────────
function BobinasAbertasBanner() {
  const [bobinas, setBobinas] = useState<OpenBobina[]>([])
  const [finalizing, setFinalizing] = useState<number | null>(null)
  const [blockedMsg, setBlockedMsg] = useState<Record<number, string>>({})

  const load = useCallback(() => {
    fetch("/api/raw-material-entries?openSummary=1").then(r => r.json()).then(setBobinas).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  async function finalizar(id: number) {
    setFinalizing(id)
    setBlockedMsg(prev => ({ ...prev, [id]: "" }))
    try {
      const res = await fetch(`/api/raw-material-entries/${id}/finalizar`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setBlockedMsg(prev => ({ ...prev, [id]: body?.error || "Não foi possível finalizar" }))
        return
      }
      load()
    } finally {
      setFinalizing(null)
    }
  }

  if (!bobinas.length) return null

  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <Layers size={14} className="text-amber-600"/>
        <p className="text-xs font-bold text-amber-700">{bobinas.length} {bobinas.length === 1 ? "bobina em aberto" : "bobinas em aberto"}</p>
      </div>
      <div className="space-y-1.5">
        {bobinas.map(b => {
          const inUse = !!b.activeOrderNumber
          const msg = blockedMsg[b.id]
          return (
            <div key={b.id} className="bg-white rounded-xl border border-amber-200 px-3.5 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-[#0F1E3C]">{b.tecido} · {b.color} — {b.productName}</p>
                  <p className="text-[10.5px] text-[#0F1E3C]/50 mt-0.5">
                    aberta há <b className="text-[#0F1E3C]/70">{b.diasAberta} dia(s)</b> · <b className="text-[#0F1E3C]/70">{b.ordens}</b> ordem(ns) já cortaram dela · <b className="text-[#0F1E3C]/70">{b.pecas}</b> peças · {fmtR(b.totalCost)} investido até agora
                  </p>
                </div>
                <button onClick={() => finalizar(b.id)} disabled={finalizing === b.id || inUse}
                  title={inUse ? `Em uso na ordem ${b.activeOrderNumber} — conclua ela primeiro` : undefined}
                  className="flex-shrink-0 text-[11px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {finalizing === b.id ? "Finalizando..." : "Finalizar bobina"}
                </button>
              </div>
              {inUse && (
                <p className="text-[10.5px] text-amber-700 font-semibold mt-2">
                  🔒 Em uso na ordem {b.activeOrderNumber} — conclua ela primeiro
                </p>
              )}
              {!inUse && msg && (
                <p className="text-[10.5px] text-red-600 font-semibold mt-2">{msg}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function ProgramacaoPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showNova, setShowNova]   = useState(false)
  const [concluding, setConcluding] = useState<Order | null>(null)
  const [editing, setEditing] = useState<Order | null>(null)
  const [fichaSheets, setFichaSheets] = useState(4)
  const [showFichaPrint, setShowFichaPrint] = useState(false)

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

  async function handleDeletar(id: number) {
    const res = await fetch(`/api/prod-orders/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body?.error || "Falha ao apagar ordem")
    }
    loadOrders()
  }

  function handlePrintFichas() {
    setShowFichaPrint(true)
    printWhenReady()
  }

  const [period, setPeriod]       = useState("30d")
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd]   = useState("")
  const [showRange, setShowRange] = useState(false)

  const active    = orders.filter(o => o.status === "em_andamento")
  const concluded = useMemo(() => {
    const done = orders.filter(o => o.status === "concluida")
    // concludedAt vem cru do banco (timestamp completo em UTC — o banco roda
    // em UTC, não Brasil). Comparar direto contra "hoje"/cutoff (que já são
    // datas no fuso do Brasil) nunca batia certo — "Hoje" ficava sempre vazio
    // e pedido concluído depois das 21h caía no dia seguinte. dateBR() converte
    // pro fuso certo antes de comparar, mesmo padrão já usado em Costura e Revisão.
    if (period === "range") {
      return done.filter(o => {
        if (!o.concludedAt) return false
        const d = dateBR(new Date(o.concludedAt))
        if (rangeStart && d < rangeStart) return false
        if (rangeEnd   && d > rangeEnd)   return false
        return true
      })
    }
    if (period === "hoje") {
      const today = todayBR()
      return done.filter(o => o.concludedAt && dateBR(new Date(o.concludedAt)) === today)
    }
    const days = { "7d":7,"15d":15,"30d":30,"60d":60 }[period] ?? 30
    const cutoff = subDaysBR(days)
    return done.filter(o => o.concludedAt && dateBR(new Date(o.concludedAt)) >= cutoff)
  }, [orders, period, rangeStart, rangeEnd])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>Programação de Produção</h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-1">Ordens vinculadas a matéria prima · custo calculado por bobina</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex items-center gap-1.5 pl-3 pr-1 py-2 rounded-xl border border-[#0F1E3C]/10 bg-white"
            title="Fichas em branco, 3 por folha — pra anotar na mão quando o PC não estiver disponível">
            <span className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wide">Folhas</span>
            <input type="number" min={1} max={30} value={fichaSheets}
              onChange={e => setFichaSheets(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="w-11 text-center text-sm font-bold text-[#0F1E3C] outline-none" />
          </div>
          <button onClick={handlePrintFichas}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-bold text-[#0F1E3C]/70 hover:bg-[#0F1E3C]/6 transition-colors">
            <Printer size={14}/> Imprimir Fichas
          </button>
          <button onClick={()=>setShowNova(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] transition-colors">
            <Plus size={14}/> Nova Ordem
          </button>
        </div>
      </div>

      <BobinasAbertasBanner/>

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
          {active.map(o => (
            <OrderBlock key={o.id} order={o}
              onConcluir={()=>setConcluding(o)}
              onEditar={()=>setEditing(o)}
              onDeletar={()=>handleDeletar(o.id)}
            />
          ))}
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
      {editing    && <NovaOrdemModal  editOrder={editing} onClose={()=>setEditing(null)} onSuccess={loadOrders}/>}
      {concluding && <ConcluirModal  order={concluding} onClose={()=>setConcluding(null)} onSuccess={loadOrders}/>}
      {showFichaPrint && <FichaProducaoPrintSheet sheets={fichaSheets} onDone={()=>setShowFichaPrint(false)} />}
    </div>
  )
}
