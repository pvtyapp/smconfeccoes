"use client"

import { useState, useCallback, useEffect } from "react"
import { Calendar, Scissors, Clock } from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"
import { fmtR } from "@/lib/format"

const PERIOD_OPTIONS = [
  { key:"hoje",  label:"Hoje"    },
  { key:"7d",    label:"7 dias"  },
  { key:"15d",   label:"15 dias" },
  { key:"30d",   label:"30 dias" },
  { key:"60d",   label:"60 dias" },
  { key:"range", label:"Período" },
]

const SIZE_ORDER = ["PP","P","M","G","GG","XGG","XXXL"]

// ─── Types ─────────────────────────────────────────────────────────────────────
type VariantCost = {
  color: string; size: string
  costMaterial: number | null   // null = pendente (bobina não esgotada)
}
type ProductCostItem = {
  id: number; name: string
  productionPct: number
  totalPieces: number
  variants: VariantCost[]
}
type Seamstress = { name: string; salary: number }

// Raw API types
type VarCostRow = {
  productId: number; productName: string
  color: string; size: string; avgMaterial: number | null
}
type GradeItem  = { color: string; size: string; qtyProduced: number | null }
type OrderRow   = { id: number; productId: number; productName: string; grade: GradeItem[]; concludedAt?: string }
type OpCostRow  = { id: number; name: string; category: string; type: string; monthlyValue: number; active: boolean }

function getPeriodDates(period: string, rangeStart: string, rangeEnd: string): [string, string] {
  const t = todayBR()
  if (period === "range" && rangeStart && rangeEnd) return [rangeStart, rangeEnd]
  if (period === "hoje") return [t, t]
  const n = period === "7d" ? 7 : period === "15d" ? 15 : period === "60d" ? 60 : 30
  return [subDaysBR(n), t]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isSewingCost(c: OpCostRow): boolean {
  return c.category === "Custo de Costura"
}

function buildProducts(orders: OrderRow[], variantCosts: VarCostRow[]): ProductCostItem[] {
  // Aggregate total pieces and SKUs per product
  type Accum = { id: number; name: string; totalPieces: number; skuSet: Set<string> }
  const map = new Map<number, Accum>()

  for (const order of orders) {
    for (const item of order.grade) {
      const qty = item.qtyProduced ?? 0
      if (qty <= 0) continue
      const acc = map.get(order.productId) ?? {
        id: order.productId, name: order.productName, totalPieces: 0, skuSet: new Set(),
      }
      acc.totalPieces += qty
      acc.skuSet.add(`${item.color}\x00${item.size}`)
      map.set(order.productId, acc)
    }
  }

  const grandTotal = [...map.values()].reduce((s, p) => s + p.totalPieces, 0)

  return [...map.values()].map(acc => {
    const productionPct = grandTotal > 0 ? Math.round((acc.totalPieces / grandTotal) * 100) : 0
    const colorSizes = [...acc.skuSet].map(s => {
      const [color, size] = s.split("\x00")
      return { color, size }
    })
    const variants: VariantCost[] = colorSizes.map(({ color, size }) => {
      const cost = variantCosts.find(
        c => c.productId === acc.id && c.color === color && c.size === size
      )
      return { color, size, costMaterial: cost ? Number(cost.avgMaterial) : null }
    })
    return { id: acc.id, name: acc.name, productionPct, totalPieces: acc.totalPieces, variants }
  })
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function CustoProducaoPage() {
  const [period,     setPeriod]     = useState("30d")
  const [showRange,  setShowRange]  = useState(false)
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd,   setRangeEnd]   = useState("")

  const [variantCosts,    setVariantCosts]    = useState<VarCostRow[]>([])
  const [orders,          setOrders]          = useState<OrderRow[]>([])
  const [operationalCosts,setOperationalCosts]= useState<OpCostRow[]>([])
  const [loading,         setLoading]         = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rCosts, rOrders, rOps] = await Promise.all([
        fetch("/api/product-variant-costs"),
        fetch("/api/prod-orders?status=concluida,encerrada"),
        fetch("/api/operational-costs"),
      ])
      const [costs, ords, ops] = await Promise.all([rCosts.json(), rOrders.json(), rOps.json()])
      if (Array.isArray(costs))  setVariantCosts(costs)
      if (Array.isArray(ords))   setOrders(ords)
      if (Array.isArray(ops))    setOperationalCosts(ops)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Period dates + days
  const [startDate, endDate] = getPeriodDates(period, rangeStart, rangeEnd)
  const periodDays = (() => {
    if (period === "range" && (!rangeStart || !rangeEnd)) return 30
    const d1 = new Date(startDate + "T00:00:00Z")
    const d2 = new Date(endDate   + "T00:00:00Z")
    return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
  })()

  // Filter orders to period
  const filteredOrders = orders.filter(o => {
    if (!o.concludedAt) return false
    const d = o.concludedAt.slice(0, 10)
    return d >= startDate && d <= endDate
  })

  // Computed
  const seamstresses: Seamstress[] = operationalCosts
    .filter(c => c.active && isSewingCost(c))
    .map(c => ({ name: c.name, salary: Number(c.monthlyValue) }))

  const products = buildProducts(filteredOrders, variantCosts)

  const monthlyTotalSewing = seamstresses.reduce((s, x) => s + x.salary, 0)
  const totalSewing  = monthlyTotalSewing * (periodDays / 30)
  const totalPieces  = products.reduce((s, p) => s + p.totalPieces, 0)
  const calcCount    = products.filter(p => p.variants.some(v => v.costMaterial !== null)).length

  const sewingRows = products.map(p => {
    const allocated    = totalSewing * (p.productionPct / 100)
    const costPerPiece = p.totalPieces > 0 ? allocated / p.totalPieces : 0
    return { ...p, allocated, costPerPiece }
  })

  const allSizes = SIZE_ORDER.filter(s =>
    products.some(p => p.variants.some(v => v.size === s))
  )

  type PivotRow = {
    productName: string; color: string; isFirstColor: boolean
    cells: Record<string, number | null | undefined>
  }
  const pivotRows: PivotRow[] = []
  for (const p of products) {
    const colors = [...new Set(p.variants.map(v => v.color))]
    colors.forEach((color, ci) => {
      const cells: Record<string, number | null | undefined> = {}
      for (const size of allSizes) {
        const v = p.variants.find(x => x.color === color && x.size === size)
        cells[size] = v ? v.costMaterial : undefined
      }
      pivotRows.push({ productName: p.name, color, isFirstColor: ci === 0, cells })
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#0F1E3C]/30">
        <p className="text-sm">Carregando custos…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Header + Period filter */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily:"var(--font-playfair)" }}>
            Custos de Produção
          </h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-1">Insumos por SKU · distribuição de costura</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {PERIOD_OPTIONS.map(opt => (
            <button key={opt.key}
              onClick={() => { setPeriod(opt.key); setShowRange(opt.key === "range") }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                period === opt.key ? "bg-[#4361EE] text-white" : "text-[#0F1E3C]/45 hover:bg-[#0F1E3C]/6"
              }`}>
              {opt.key === "range" && <Calendar size={11}/>}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {showRange && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#4361EE]/20">
          <Calendar size={14} className="text-[#4361EE]"/>
          <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
            className="border border-[#0F1E3C]/12 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
          <span className="text-xs text-[#0F1E3C]/40">até</span>
          <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
            className="border border-[#0F1E3C]/12 rounded-lg px-3 py-1.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"/>
        </div>
      )}

      {/* Summary stats */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-[#0F1E3C]/6">
          {[
            { label:"Produtos",            display: String(products.length),               color:"text-[#0F1E3C]"   },
            { label:"Com custo calculado", display: `${calcCount}/${products.length}`,     color:"text-emerald-600" },
            { label:"Peças no período",    display: `${totalPieces} pç`,                   color:"text-[#0F1E3C]"   },
            { label:`Costura (${periodDays}d)`, display: fmtR(totalSewing),                 color:"text-[#4361EE]"   },
          ].map(s => (
            <div key={s.label} className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.display}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mix de Produção + Custo Costura */}
      <div className="grid grid-cols-2 gap-4">

        {/* Mix */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-5">
          <p className="text-sm font-bold text-[#0F1E3C] mb-0.5">Mix de Produção</p>
          <p className="text-xs text-[#0F1E3C]/40 mb-4">% de peças produzidas por produto</p>
          {products.length === 0 ? (
            <p className="text-xs text-[#0F1E3C]/30 py-4">Nenhuma ordem concluída ainda</p>
          ) : (
            <div className="space-y-4">
              {products.map(p => (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-[#0F1E3C]">{p.name}</span>
                    <span className="text-sm font-black text-[#4361EE]">{p.productionPct}%</span>
                  </div>
                  <div className="h-2 bg-[#F0F2F8] rounded-full overflow-hidden">
                    <div className="h-full bg-[#4361EE] rounded-full" style={{ width:`${p.productionPct}%` }}/>
                  </div>
                  <p className="text-[10px] text-[#0F1E3C]/35 mt-1">{p.totalPieces} peças</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custo Costura */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-5">
          <div className="flex items-center gap-2 mb-0.5">
            <Scissors size={14} className="text-[#4361EE]"/>
            <p className="text-sm font-bold text-[#0F1E3C]">Custo Costura</p>
          </div>
          <p className="text-xs text-[#0F1E3C]/40 mb-3">
            Σ salários × % do mix ÷ peças produzidas
          </p>

          {seamstresses.length === 0 ? (
            <div className="px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6 mb-3">
              <p className="text-xs text-[#0F1E3C]/40">
                Nenhum custo de costura cadastrado. Adicione na aba{" "}
                <span className="font-semibold">Custo Operacional</span> com categoria &quot;costura&quot;.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {seamstresses.map(s => (
                  <div key={s.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F0F2F8]">
                    <span className="text-[11px] font-semibold text-[#0F1E3C]">{s.name}</span>
                    <span className="text-[11px] text-[#0F1E3C]/40">{fmtR(s.salary)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#4361EE]/6 border border-[#4361EE]/15 mb-3">
                <span className="text-xs text-[#0F1E3C]/50">Total costura no período</span>
                <span className="font-black text-[#4361EE]">{fmtR(totalSewing)}</span>
              </div>
            </>
          )}

          {products.length > 0 && (
            <div className="space-y-2">
              {sewingRows.map(s => (
                <div key={s.name}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F9FAFB] border border-[#0F1E3C]/6">
                  <div>
                    <p className="text-xs font-semibold text-[#0F1E3C]">{s.name}</p>
                    <p className="text-[10px] text-[#0F1E3C]/35">
                      {s.productionPct}% · {fmtR(s.allocated)} alocado
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-[#0F1E3C]">
                      {fmtR(s.costPerPiece)}
                      <span className="text-[10px] font-normal text-[#0F1E3C]/40">/pç</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Custo de Insumos por SKU — tabela pivot */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-[#0F1E3C]/35">
            Custo de Insumos por SKU
          </p>
          <p className="text-[10px] text-[#0F1E3C]/30">
            Preenchido automaticamente ao esgotar cada bobina
          </p>
        </div>

        {pivotRows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 flex items-center justify-center py-10">
            <p className="text-xs text-[#0F1E3C]/30">Nenhum dado de custo disponível ainda</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F9FAFB] border-b border-[#0F1E3C]/6">
                    <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 w-44">
                      Produto
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 w-28">
                      Cor
                    </th>
                    {allSizes.map(size => (
                      <th key={size}
                        className="text-center px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 w-20">
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.map((row, ri) => {
                    const isNewGroup = ri > 0 && row.isFirstColor
                    return (
                      <tr key={`${row.productName}-${row.color}`}
                        className={`hover:bg-[#F9FAFB]/60 transition-colors border-b border-[#0F1E3C]/4 ${
                          isNewGroup ? "border-t-2 border-t-[#0F1E3C]/8" : ""
                        }`}>
                        <td className="px-5 py-3">
                          {row.isFirstColor
                            ? <span className="text-sm font-semibold text-[#0F1E3C]">{row.productName}</span>
                            : null
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-[#0F1E3C]/55">{row.color}</span>
                        </td>
                        {allSizes.map(size => {
                          const val = row.cells[size]
                          return (
                            <td key={size} className="px-3 py-3 text-center">
                              {val === undefined ? (
                                <span className="text-[#0F1E3C]/12 text-sm">—</span>
                              ) : val === null ? (
                                <span className="inline-flex items-center justify-center gap-0.5 text-[9px] text-[#0F1E3C]/25">
                                  <Clock size={8}/> pend.
                                </span>
                              ) : (
                                <span className="text-xs font-bold text-emerald-600">{fmtR(val)}</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-5 px-5 py-3 border-t border-[#0F1E3C]/5 bg-[#F9FAFB]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-emerald-600">R$ 0,00</span>
                <span className="text-[10px] text-[#0F1E3C]/35">custo calculado</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={9} className="text-[#0F1E3C]/25"/>
                <span className="text-[10px] text-[#0F1E3C]/35">pend. — bobina não esgotou</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-[#0F1E3C]/12">—</span>
                <span className="text-[10px] text-[#0F1E3C]/35">tamanho não produzido</span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
