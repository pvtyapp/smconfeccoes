"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, AlertTriangle, CheckCircle2, Package, Printer, ChevronRight } from "lucide-react"

// ─── Mock (remover quando houver dados reais) ─────────────────────────────────
const USE_MOCK = false

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "urgent" | "monitor" | "parado"
type PatternEntry = { seg: number; vel: number; n: number }

type VariantMetric = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string
  minStock: number; targetStock: number; currentStock: number; sales30d: number
  velocityCurrent: number; velocityPrevMonth: number; vel30d: number
  trendPct: number | null; pattern: PatternEntry[]
  nextSeg: 1|2|3|4; daysCurrent: number|null; daysNext: number|null
  priority: Priority; suggestedProduction: number
}

type MetricsData = {
  currentSeg: 1|2|3|4; currentDay: number; currentMo: number; currentYr: number
  variants: VariantMetric[]
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_DATA: MetricsData = {
  currentSeg: 3, currentDay: 21, currentMo: 5, currentYr: 2026,
  variants: [
    { variantId:"m1", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"M", sku:"MOLETOM-PRETO-M",
      minStock:10, targetStock:60, currentStock:8, sales30d:52, velocityCurrent:3.8, velocityPrevMonth:4.2, vel30d:1.7, trendPct:-10,
      pattern:[{seg:1,vel:4.5,n:2},{seg:2,vel:2.8,n:2},{seg:3,vel:3.8,n:1},{seg:4,vel:1.2,n:2}],
      nextSeg:4, daysCurrent:2.1, daysNext:6.7, priority:"urgent", suggestedProduction:52 },
    { variantId:"m2", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"G", sku:"MOLETOM-PRETO-G",
      minStock:10, targetStock:60, currentStock:22, sales30d:38, velocityCurrent:2.5, velocityPrevMonth:3.1, vel30d:1.3, trendPct:-19,
      pattern:[{seg:1,vel:3.8,n:2},{seg:2,vel:2.1,n:2},{seg:3,vel:2.5,n:1},{seg:4,vel:0.9,n:2}],
      nextSeg:4, daysCurrent:8.8, daysNext:24.4, priority:"parado", suggestedProduction:0 },
    { variantId:"m3", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"P", sku:"MOLETOM-PRETO-P",
      minStock:5, targetStock:30, currentStock:45, sales30d:12, velocityCurrent:0.8, velocityPrevMonth:1.1, vel30d:0.4, trendPct:-27,
      pattern:[{seg:1,vel:1.4,n:2},{seg:2,vel:0.9,n:2},{seg:3,vel:0.8,n:1},{seg:4,vel:0.4,n:2}],
      nextSeg:4, daysCurrent:56.3, daysNext:112.5, priority:"parado", suggestedProduction:0 },
    { variantId:"m4", productId:"p2", productName:"Camiseta Básica", color:"Preto", size:"M", sku:"CAMISETA-PRETO-M",
      minStock:20, targetStock:80, currentStock:34, sales30d:72, velocityCurrent:2.4, velocityPrevMonth:1.8, vel30d:2.4, trendPct:33,
      pattern:[{seg:1,vel:3.2,n:2},{seg:2,vel:2.1,n:2},{seg:3,vel:2.4,n:1},{seg:4,vel:1.5,n:2}],
      nextSeg:4, daysCurrent:14.2, daysNext:22.7, priority:"monitor", suggestedProduction:55 },
    { variantId:"m5", productId:"p2", productName:"Camiseta Básica", color:"Preto", size:"G", sku:"CAMISETA-PRETO-G",
      minStock:20, targetStock:80, currentStock:12, sales30d:68, velocityCurrent:3.1, velocityPrevMonth:2.4, vel30d:2.3, trendPct:29,
      pattern:[{seg:1,vel:3.8,n:2},{seg:2,vel:2.5,n:2},{seg:3,vel:3.1,n:1},{seg:4,vel:1.8,n:2}],
      nextSeg:4, daysCurrent:3.9, daysNext:6.7, priority:"urgent", suggestedProduction:82 },
    { variantId:"m6", productId:"p2", productName:"Camiseta Básica", color:"Branco", size:"M", sku:"CAMISETA-BRANCO-M",
      minStock:20, targetStock:80, currentStock:78, sales30d:15, velocityCurrent:0.3, velocityPrevMonth:0.5, vel30d:0.5, trendPct:-40,
      pattern:[{seg:1,vel:0.8,n:2},{seg:2,vel:0.5,n:2},{seg:3,vel:0.3,n:1},{seg:4,vel:0.2,n:2}],
      nextSeg:4, daysCurrent:260.0, daysNext:390.0, priority:"parado", suggestedProduction:0 },
    { variantId:"m7", productId:"p3", productName:"Calça Moletom", color:"Preto", size:"M", sku:"CALÇA-PRETO-M",
      minStock:10, targetStock:50, currentStock:25, sales30d:43, velocityCurrent:1.9, velocityPrevMonth:1.7, vel30d:1.4, trendPct:12,
      pattern:[{seg:1,vel:2.3,n:2},{seg:2,vel:1.6,n:2},{seg:3,vel:1.9,n:1},{seg:4,vel:0.8,n:2}],
      nextSeg:4, daysCurrent:13.2, daysNext:31.3, priority:"parado", suggestedProduction:0 },
    { variantId:"m8", productId:"p3", productName:"Calça Moletom", color:"Preto", size:"G", sku:"CALÇA-PRETO-G",
      minStock:10, targetStock:50, currentStock:6, sales30d:35, velocityCurrent:2.2, velocityPrevMonth:1.9, vel30d:1.2, trendPct:16,
      pattern:[{seg:1,vel:2.8,n:2},{seg:2,vel:1.8,n:2},{seg:3,vel:2.2,n:1},{seg:4,vel:0.7,n:2}],
      nextSeg:4, daysCurrent:2.7, daysNext:8.6, priority:"urgent", suggestedProduction:53 },
    { variantId:"m9", productId:"p4", productName:"Bermuda Moletom", color:"Cinza", size:"G", sku:"BERMUDA-CINZA-G",
      minStock:5, targetStock:30, currentStock:18, sales30d:0, velocityCurrent:0, velocityPrevMonth:0, vel30d:0, trendPct:null,
      pattern:[{seg:1,vel:0,n:0},{seg:2,vel:0,n:0},{seg:3,vel:0,n:0},{seg:4,vel:0,n:0}],
      nextSeg:4, daysCurrent:null, daysNext:null, priority:"parado", suggestedProduction:0 },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<Priority, number> = { urgent:0, monitor:1, parado:2 }
const PRIORITY_LABEL: Record<Priority, string> = { urgent:"Urgente", monitor:"Monitorar", parado:"Parado" }
const SEG_LABELS = ["Sem. 1", "Sem. 2", "Sem. 3", "Sem. 4"]
const SEG_DAYS   = ["dias 1–7", "dias 8–14", "dias 15–21", "dias 22+"]

function worstPriority(ps: Priority[]): Priority {
  return ps.reduce((w, p) => PRIORITY_ORDER[p] < PRIORITY_ORDER[w] ? p : w, "parado" as Priority)
}

function daysColor(d: number | null) {
  if (d === null) return "text-[#0F1E3C]/25"
  if (d <= 3)    return "text-red-600 font-black"
  if (d <= 7)    return "text-orange-500 font-bold"
  if (d <= 14)   return "text-amber-600 font-bold"
  return "text-emerald-600 font-bold"
}

function fmtDays(d: number | null) {
  if (d === null) return "—"
  if (d > 999)   return "∞"
  return `${d.toFixed(1)}d`
}

function daysUntilNext(seg: number, day: number, yr: number, mo: number) {
  if (seg === 1) return 8 - day
  if (seg === 2) return 15 - day
  if (seg === 3) return 22 - day
  return new Date(yr, mo, 0).getDate() - day + 1
}

function fmtDateBR(yr: number, mo: number, day: number) {
  return `${String(day).padStart(2,"0")}/${String(mo).padStart(2,"0")}/${yr}`
}

// ─── Mini components ──────────────────────────────────────────────────────────

function TrendChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-[#0F1E3C]/20">—</span>
  const up   = pct > 15
  const down = pct < -15
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
      up   ? "bg-emerald-100 text-emerald-700" :
      down ? "bg-red-100 text-red-600"          :
             "bg-[#0F1E3C]/6 text-[#0F1E3C]/40"
    }`}>
      {up ? "↑" : down ? "↓" : "→"} {pct > 0 ? "+" : ""}{pct}%
    </span>
  )
}

function PriorityDot({ priority }: { priority: Priority }) {
  const colors: Record<Priority, string> = {
    urgent: "bg-red-500", monitor: "bg-orange-400", parado: "bg-[#0F1E3C]/20",
  }
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[priority]}`} />
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg: Record<Priority, { bg: string; text: string }> = {
    urgent:  { bg: "bg-red-100",     text: "text-red-600"    },
    monitor: { bg: "bg-orange-100",  text: "text-orange-600" },
    parado:  { bg: "bg-[#0F1E3C]/6", text: "text-[#0F1E3C]/40" },
  }
  const c = cfg[priority]
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {PRIORITY_LABEL[priority].toUpperCase()}
    </span>
  )
}

function PatternBars({ pattern, currentSeg }: { pattern: PatternEntry[]; currentSeg: number }) {
  const max = Math.max(...pattern.map(p => p.vel), 0.01)
  return (
    <div className="flex items-end gap-1" title="Padrão histórico por semana do mês">
      {pattern.map(p => {
        const h = Math.max(Math.round((p.vel / max) * 20), 2)
        const active = p.seg === currentSeg
        return (
          <div key={p.seg} className="flex flex-col items-center gap-0.5">
            <div style={{ height: h }} className={`w-3 rounded-sm ${active ? "bg-[#4361EE]" : p.n > 0 ? "bg-[#0F1E3C]/20" : "bg-[#0F1E3C]/6"}`} />
            <span className={`text-[8px] font-bold ${active ? "text-[#4361EE]" : "text-[#0F1E3C]/20"}`}>S{p.seg}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Print sheet (só sai no papel — ver classes print:/hidden) ────────────────

function PrintSheet({ groups, totalItems, totalPieces, dateLabel }: {
  groups: { productName: string; rows: { color: string; size: string; priority: Priority; qty: number }[] }[]
  totalItems: number; totalPieces: number; dateLabel: string
}) {
  return (
    <div className="hidden print:block px-2 py-4 text-[#14213D]">
      <div className="flex items-end justify-between border-b-2 border-[#14213D] pb-3 mb-4">
        <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-playfair)" }}>Lista de Produção</h2>
        <div className="text-right text-[11px] text-[#5A6B8C] leading-relaxed">SM Confecções<br />{dateLabel}</div>
      </div>
      <div className="flex justify-between text-xs text-[#5A6B8C] mb-5">
        <span>{totalItems} {totalItems === 1 ? "item" : "itens"} para produzir</span>
        <span><strong className="text-[#14213D] text-sm">{totalPieces}</strong> peças no total</span>
      </div>
      {groups.map(g => (
        <div key={g.productName} className="mb-4">
          <p className="text-sm font-bold border-b border-[#D8DEEC] pb-1.5 mb-1.5">{g.productName}</p>
          {g.rows.map((r, i) => (
            <div key={i} className="grid items-center gap-2.5 py-1.5 border-b border-dashed border-[#E4E8F2] text-sm"
              style={{ gridTemplateColumns: "18px 1fr 80px 60px" }}>
              <span className="w-3.5 h-3.5 border-[1.5px] border-[#14213D] rounded-[3px]" />
              <span>Tam. {r.size} <span className="text-[#5A6B8C] text-[11.5px]">· {r.color}</span></span>
              <span className={`text-[9.5px] font-bold uppercase text-right ${r.priority === "urgent" ? "text-red-600" : "text-orange-600"}`}>
                {PRIORITY_LABEL[r.priority]}
              </span>
              <span className="font-bold text-right">{r.qty} pç</span>
            </div>
          ))}
        </div>
      ))}
      <div className="flex justify-between text-[10.5px] text-[#8B96AD] mt-6 pt-3 border-t border-[#D8DEEC]">
        <span>Gerado em {dateLabel}</span>
        <span>smconfeccoes.vercel.app/dashboard/metricas</span>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MetricasPage() {
  const [data, setData]         = useState<MetricsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState("")
  const [filter, setFilter]     = useState<"all" | Priority>("all")
  // Guarda só quem o usuário clicou pra inverter o padrão — não precisa
  // sincronizar com os dados carregados, então dispensa efeito de setState.
  const [toggled, setToggled]   = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true); setError("")
    if (USE_MOCK) { setData(MOCK_DATA); setLoading(false); return }
    try {
      const res = await fetch("/api/stock/metrics")
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro ao carregar")
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const { products, notices, stats, daysToNext, printGroups, printTotals } = useMemo(() => {
    if (!data) return {
      products: [], notices: { urgent: [], monitor: [], parado: [] },
      stats: { urgent:0, monitor:0, parado:0, totalProd:0 }, daysToNext: 0,
      printGroups: [] as { productName: string; rows: { color: string; size: string; priority: Priority; qty: number }[] }[],
      printTotals: { items: 0, pieces: 0 },
    }

    // Group by product → then by color
    const map = new Map<string, { name: string; variants: VariantMetric[] }>()
    for (const v of data.variants) {
      if (!map.has(v.productId)) map.set(v.productId, { name: v.productName, variants: [] })
      map.get(v.productId)!.variants.push(v)
    }

    const products = [...map.entries()]
      .map(([productId, g]) => {
        const worst = worstPriority(g.variants.map(v => v.priority))
        const colorMap = new Map<string, VariantMetric[]>()
        for (const v of g.variants) {
          if (!colorMap.has(v.color)) colorMap.set(v.color, [])
          colorMap.get(v.color)!.push(v)
        }
        return {
          productId,
          productName: g.name,
          worstPriority: worst,
          totalStock: g.variants.reduce((s, v) => s + v.currentStock, 0),
          totalSales30d: g.variants.reduce((s, v) => s + v.sales30d, 0),
          colorGroups: [...colorMap.entries()],
        }
      })
      .sort((a, b) => PRIORITY_ORDER[a.worstPriority] - PRIORITY_ORDER[b.worstPriority] || a.productName.localeCompare(b.productName))

    // Notice board items
    const urgent = data.variants.filter(v => v.priority === "urgent")
    const monitor = data.variants.filter(v => v.priority === "monitor")
    const parado = data.variants.filter(v => v.priority === "parado")

    const stats = {
      urgent:  urgent.length,
      monitor: monitor.length,
      parado:  parado.length,
      totalProd: data.variants.reduce((s, v) => s + v.suggestedProduction, 0),
    }

    const daysToNext = daysUntilNext(data.currentSeg, data.currentDay, data.currentYr, data.currentMo)

    // Print list — só o que precisa de ação (urgente + monitorar), agrupado por produto
    const printGroups = products
      .map(p => {
        const rows = p.colorGroups.flatMap(([color, variants]) =>
          variants
            .filter(v => v.priority === "urgent" || v.priority === "monitor")
            .map(v => ({ color, size: v.size, priority: v.priority, qty: v.suggestedProduction }))
        )
        return { productName: p.productName, rows }
      })
      .filter(g => g.rows.length > 0)

    const printTotals = {
      items: printGroups.reduce((s, g) => s + g.rows.length, 0),
      pieces: printGroups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + r.qty, 0), 0),
    }

    return { products, notices: { urgent, monitor, parado }, stats, daysToNext, printGroups, printTotals }
  }, [data])

  const visibleProducts = useMemo(() => {
    if (filter === "all") return products
    return products.filter(p => p.colorGroups.some(([, variants]) => variants.some(v => v.priority === filter)))
  }, [products, filter])

  function toggleProduct(id: string) {
    setToggled(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const dateLabel = data ? `${SEG_LABELS[data.currentSeg - 1]} · ${fmtDateBR(data.currentYr, data.currentMo, data.currentDay)}` : ""

  // ─── States ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-[#0F1E3C]/35">
      <AlertTriangle size={32} strokeWidth={1.5} />
      <p className="text-sm">{error}</p>
      <button onClick={load} className="text-xs text-[#4361EE] underline">Tentar novamente</button>
    </div>
  )

  if (!data) return null

  // ─── Render ───────────────────────────────────────────────────────────────

  const chips: { key: "all" | Priority; label: string; n: number }[] = [
    { key: "all",     label: "Todos",     n: data.variants.length },
    { key: "urgent",  label: "Urgente",   n: stats.urgent },
    { key: "monitor", label: "Monitorar", n: stats.monitor },
    { key: "parado",  label: "Parado",    n: stats.parado },
  ]

  return (
    <>
      <div className="space-y-5 print:hidden">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
              Métricas Produção × Vendas
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-[#0F1E3C]/45">
                {SEG_LABELS[data.currentSeg - 1]} · {SEG_DAYS[data.currentSeg - 1]} · dia {data.currentDay}
              </span>
              <span className="text-[#0F1E3C]/20">·</span>
              <span className={`text-xs font-semibold ${daysToNext <= 2 ? "text-orange-500" : "text-[#0F1E3C]/45"}`}>
                próxima fase em {daysToNext} {daysToNext === 1 ? "dia" : "dias"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-shrink-0">
            <button
              onClick={() => window.print()}
              disabled={printTotals.items === 0}
              title={printTotals.items === 0 ? "Nada pra produzir agora" : "Imprimir lista de produção"}
              className="flex items-center gap-1.5 bg-[#4361EE] hover:bg-[#3451D4] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-colors"
            >
              <Printer size={14} /> Imprimir lista
            </button>
            <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Produzir agora",    value: stats.urgent,           accent: "text-red-600",    sub: "variações urgentes" },
            { label: "Monitorar",         value: stats.monitor,          accent: "text-orange-500", sub: "ficar de olho" },
            { label: "Parado",            value: stats.parado,           accent: "text-[#0F1E3C]/50", sub: "sem ação necessária" },
            { label: "Produção sugerida", value: `${stats.totalProd} pç`, accent: "text-[#4361EE]",  sub: "total urgentes + monitorar" },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl border border-[#0F1E3C]/8 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">{c.label}</p>
              <p className={`text-2xl font-black mt-1 ${c.accent}`}>{c.value}</p>
              <p className="text-xs text-[#0F1E3C]/30 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Quadro de Avisos */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Quadro de Avisos</h2>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">Resumo das ações necessárias</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[#0F1E3C]/6">

            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <p className="text-xs font-bold text-[#0F1E3C]">Produzir agora</p>
              </div>
              {notices.urgent.length === 0 ? (
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 size={13} />
                  <p className="text-xs">Tudo em dia</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notices.urgent.map(v => (
                    <div key={v.variantId} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F1E3C] truncate">{v.productName}</p>
                        <p className="text-xs text-[#0F1E3C]/40">{v.color} · {v.size}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-emerald-600">+{v.suggestedProduction} pç</p>
                        <p className="text-[10px] text-red-500 font-semibold">{fmtDays(v.daysCurrent)} restantes</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
                <p className="text-xs font-bold text-[#0F1E3C]">Monitorar</p>
              </div>
              {notices.monitor.length === 0 ? (
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 size={13} />
                  <p className="text-xs">Nada em alerta</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notices.monitor.map(v => (
                    <div key={v.variantId} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F1E3C] truncate">{v.productName}</p>
                        <p className="text-xs text-[#0F1E3C]/40">{v.color} · {v.size}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {v.suggestedProduction > 0 && (
                          <p className="text-sm font-black text-emerald-600">+{v.suggestedProduction} pç</p>
                        )}
                        <p className="text-[10px] text-orange-500 font-semibold">{fmtDays(v.daysCurrent)} restantes</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#0F1E3C]/20 flex-shrink-0" />
                <p className="text-xs font-bold text-[#0F1E3C]">Parado</p>
              </div>
              {notices.parado.length === 0 ? (
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 size={13} />
                  <p className="text-xs">Giro saudável</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notices.parado.map(v => (
                    <div key={v.variantId} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F1E3C] truncate">{v.productName}</p>
                        <p className="text-xs text-[#0F1E3C]/40">{v.color} · {v.size}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-[#0F1E3C]/40 font-semibold">
                          {v.sales30d === 0 && v.velocityCurrent === 0 ? "sem saída" : fmtDays(v.daysCurrent)}
                        </p>
                        {v.trendPct !== null && <TrendChip pct={v.trendPct} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map(c => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                filter === c.key
                  ? "bg-[#0F1E3C] border-[#0F1E3C] text-white"
                  : "bg-white border-[#0F1E3C]/10 text-[#0F1E3C]/50 hover:border-[#4361EE] hover:text-[#0F1E3C]"
              }`}
            >
              {c.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === c.key ? "bg-white/15" : "bg-[#0F1E3C]/6 text-[#0F1E3C]/35"}`}>
                {c.n}
              </span>
            </button>
          ))}
        </div>

        {/* Product cards (accordion) */}
        {visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
            <Package size={40} strokeWidth={1.2} />
            <p className="text-sm">Nenhum produto nesse estágio agora.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleProducts.map(product => {
              const defaultOpen = product.worstPriority !== "parado"
              const open = toggled.has(product.productId) ? !defaultOpen : defaultOpen
              return (
                <div key={product.productId} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">

                  <button
                    onClick={() => toggleProduct(product.productId)}
                    className="w-full flex items-center justify-between px-5 py-3.5 border-b border-[#0F1E3C]/6 hover:bg-[#F9FAFB] transition-colors text-left"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ChevronRight size={15} className={`text-[#0F1E3C]/25 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                      <div className="min-w-0">
                        <p className="font-bold text-[#0F1E3C] truncate" style={{ fontFamily: "var(--font-playfair)" }}>{product.productName}</p>
                        <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                          {product.totalStock} pç em estoque · {product.totalSales30d} vendas 30d
                        </p>
                      </div>
                    </div>
                    <PriorityBadge priority={product.worstPriority} />
                  </button>

                  {open && (
                    <div>
                      <div className="grid items-center px-5 py-2 bg-[#F9FAFB] border-b border-[#0F1E3C]/5"
                        style={{ gridTemplateColumns: "2rem 5rem 1fr 5rem 5rem 6rem 2.5rem 4rem" }}>
                        {["TAM", "ESTOQUE", "GIRO ATUAL", "MÊS ANT.", "DURA", "TENDÊNCIA", "", ""].map((h, i) => (
                          <p key={i} className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/25">{h}</p>
                        ))}
                      </div>

                      {product.colorGroups.map(([color, variants]) => (
                        <div key={color}>
                          <div className="flex items-center gap-2 px-5 py-2 bg-[#F4F6FB] border-b border-[#0F1E3C]/6">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#0F1E3C]/30" />
                            <p className="text-xs font-bold text-[#0F1E3C]/50">{color || "Sem cor"}</p>
                          </div>
                          {variants.map((v, idx) => (
                            <div
                              key={v.variantId}
                              className={`grid items-center px-5 py-3 hover:bg-[#F9FAFB] transition-colors ${idx < variants.length - 1 ? "border-b border-[#0F1E3C]/4" : ""}`}
                              style={{ gridTemplateColumns: "2rem 5rem 1fr 5rem 5rem 6rem 2.5rem 4rem" }}
                            >
                              <p className="text-sm font-black text-[#0F1E3C]">{v.size || "—"}</p>

                              <span className={`text-sm font-bold inline-flex items-center ${
                                v.currentStock === 0              ? "text-red-600"    :
                                v.currentStock <= v.minStock      ? "text-orange-500" :
                                                                    "text-[#0F1E3C]"
                              }`}>
                                {v.currentStock} pç
                              </span>

                              <p className="text-sm font-semibold text-[#0F1E3C]">
                                {v.velocityCurrent > 0 ? `${v.velocityCurrent.toFixed(1)} pç/dia` : "—"}
                              </p>

                              <p className="text-sm text-[#0F1E3C]/45">
                                {v.velocityPrevMonth > 0 ? `${v.velocityPrevMonth.toFixed(1)}/dia` : "—"}
                              </p>

                              <p className={`text-sm ${daysColor(v.daysCurrent)}`}>{fmtDays(v.daysCurrent)}</p>

                              <TrendChip pct={v.trendPct} />

                              <PatternBars pattern={v.pattern} currentSeg={data.currentSeg} />

                              {v.suggestedProduction > 0 ? (
                                <p className="text-xs font-black text-emerald-600 text-right">+{v.suggestedProduction}</p>
                              ) : (
                                <p className="text-xs text-[#0F1E3C]/15 text-right">—</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        )}

      </div>

      <PrintSheet groups={printGroups} totalItems={printTotals.items} totalPieces={printTotals.pieces} dateLabel={dateLabel} />
    </>
  )
}
