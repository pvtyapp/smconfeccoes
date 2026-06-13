"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, AlertTriangle, CheckCircle2, Package } from "lucide-react"

// ─── Mock (remover quando houver dados reais) ─────────────────────────────────
const USE_MOCK = true

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "urgent" | "attention" | "ok" | "excess" | "stopped"
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
    // Moletom Canguru — Preto
    // M: 2.1d estoque, estável → URGENTE, repõe até target
    { variantId:"m1", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"M", sku:"MOLETOM-PRETO-M",
      minStock:10, targetStock:60, currentStock:8, sales30d:52, velocityCurrent:3.8, velocityPrevMonth:4.2, vel30d:1.7, trendPct:-10,
      pattern:[{seg:1,vel:4.5,n:2},{seg:2,vel:2.8,n:2},{seg:3,vel:3.8,n:1},{seg:4,vel:1.2,n:2}],
      nextSeg:4, daysCurrent:2.1, daysNext:6.7, priority:"urgent", suggestedProduction:52 },
    // G: 8.8d, caindo 19% → efetivo 11d → OK (deixa escoar, não repõe target)
    { variantId:"m2", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"G", sku:"MOLETOM-PRETO-G",
      minStock:10, targetStock:60, currentStock:22, sales30d:38, velocityCurrent:2.5, velocityPrevMonth:3.1, vel30d:1.3, trendPct:-19,
      pattern:[{seg:1,vel:3.8,n:2},{seg:2,vel:2.1,n:2},{seg:3,vel:2.5,n:1},{seg:4,vel:0.9,n:2}],
      nextSeg:4, daysCurrent:8.8, daysNext:24.4, priority:"ok", suggestedProduction:0 },
    // P: 56d, caindo 27% → EXCESSO, redireciona capacidade
    { variantId:"m3", productId:"p1", productName:"Moletom Canguru", color:"Preto", size:"P", sku:"MOLETOM-PRETO-P",
      minStock:5, targetStock:30, currentStock:45, sales30d:12, velocityCurrent:0.8, velocityPrevMonth:1.1, vel30d:0.4, trendPct:-27,
      pattern:[{seg:1,vel:1.4,n:2},{seg:2,vel:0.9,n:2},{seg:3,vel:0.8,n:1},{seg:4,vel:0.4,n:2}],
      nextSeg:4, daysCurrent:56.3, daysNext:112.5, priority:"excess", suggestedProduction:0 },
    // Camiseta Básica — Preto
    // M: 14.2d, crescendo 33% → efetivo 11.4d → ATENÇÃO, repõe +20% (crescimento)
    { variantId:"m4", productId:"p2", productName:"Camiseta Básica", color:"Preto", size:"M", sku:"CAMISETA-PRETO-M",
      minStock:20, targetStock:80, currentStock:34, sales30d:72, velocityCurrent:2.4, velocityPrevMonth:1.8, vel30d:2.4, trendPct:33,
      pattern:[{seg:1,vel:3.2,n:2},{seg:2,vel:2.1,n:2},{seg:3,vel:2.4,n:1},{seg:4,vel:1.5,n:2}],
      nextSeg:4, daysCurrent:14.2, daysNext:22.7, priority:"attention", suggestedProduction:55 },
    // G: 3.9d, crescendo 29% → efetivo 3.1d, crescendo e < 5d → URGENTE, +20% buffer
    { variantId:"m5", productId:"p2", productName:"Camiseta Básica", color:"Preto", size:"G", sku:"CAMISETA-PRETO-G",
      minStock:20, targetStock:80, currentStock:12, sales30d:68, velocityCurrent:3.1, velocityPrevMonth:2.4, vel30d:2.3, trendPct:29,
      pattern:[{seg:1,vel:3.8,n:2},{seg:2,vel:2.5,n:2},{seg:3,vel:3.1,n:1},{seg:4,vel:1.8,n:2}],
      nextSeg:4, daysCurrent:3.9, daysNext:6.7, priority:"urgent", suggestedProduction:82 },
    // Branco M: 260d, caindo 40% → EXCESSO, não produz
    { variantId:"m6", productId:"p2", productName:"Camiseta Básica", color:"Branco", size:"M", sku:"CAMISETA-BRANCO-M",
      minStock:20, targetStock:80, currentStock:78, sales30d:15, velocityCurrent:0.3, velocityPrevMonth:0.5, vel30d:0.5, trendPct:-40,
      pattern:[{seg:1,vel:0.8,n:2},{seg:2,vel:0.5,n:2},{seg:3,vel:0.3,n:1},{seg:4,vel:0.2,n:2}],
      nextSeg:4, daysCurrent:260.0, daysNext:390.0, priority:"excess", suggestedProduction:0 },
    // Calça Moletom — Preto
    // M: 13.2d, estável +12% → OK
    { variantId:"m7", productId:"p3", productName:"Calça Moletom", color:"Preto", size:"M", sku:"CALÇA-PRETO-M",
      minStock:10, targetStock:50, currentStock:25, sales30d:43, velocityCurrent:1.9, velocityPrevMonth:1.7, vel30d:1.4, trendPct:12,
      pattern:[{seg:1,vel:2.3,n:2},{seg:2,vel:1.6,n:2},{seg:3,vel:1.9,n:1},{seg:4,vel:0.8,n:2}],
      nextSeg:4, daysCurrent:13.2, daysNext:31.3, priority:"ok", suggestedProduction:0 },
    // G: 2.7d, crescendo 16% → efetivo 2.2d → URGENTE, +20% buffer de crescimento
    { variantId:"m8", productId:"p3", productName:"Calça Moletom", color:"Preto", size:"G", sku:"CALÇA-PRETO-G",
      minStock:10, targetStock:50, currentStock:6, sales30d:35, velocityCurrent:2.2, velocityPrevMonth:1.9, vel30d:1.2, trendPct:16,
      pattern:[{seg:1,vel:2.8,n:2},{seg:2,vel:1.8,n:2},{seg:3,vel:2.2,n:1},{seg:4,vel:0.7,n:2}],
      nextSeg:4, daysCurrent:2.7, daysNext:8.6, priority:"urgent", suggestedProduction:53 },
    // Bermuda — sazonalidade, sem vendas no período
    { variantId:"m9", productId:"p4", productName:"Bermuda Moletom", color:"Cinza", size:"G", sku:"BERMUDA-CINZA-G",
      minStock:5, targetStock:30, currentStock:18, sales30d:0, velocityCurrent:0, velocityPrevMonth:0, vel30d:0, trendPct:null,
      pattern:[{seg:1,vel:0,n:0},{seg:2,vel:0,n:0},{seg:3,vel:0,n:0},{seg:4,vel:0,n:0}],
      nextSeg:4, daysCurrent:null, daysNext:null, priority:"stopped", suggestedProduction:0 },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<Priority, number> = { urgent:0, attention:1, ok:2, excess:3, stopped:4 }
const SEG_LABELS = ["Sem. 1", "Sem. 2", "Sem. 3", "Sem. 4"]
const SEG_DAYS   = ["dias 1–7", "dias 8–14", "dias 15–21", "dias 22+"]

function worstPriority(ps: Priority[]): Priority {
  return ps.reduce((w, p) => PRIORITY_ORDER[p] < PRIORITY_ORDER[w] ? p : w, "stopped" as Priority)
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
    urgent: "bg-red-500", attention: "bg-orange-400",
    ok: "bg-emerald-500", excess: "bg-purple-400", stopped: "bg-[#0F1E3C]/20",
  }
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[priority]}`} />
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg: Record<Priority, { bg: string; text: string; label: string }> = {
    urgent:    { bg: "bg-red-100",     text: "text-red-600",     label: "URGENTE"  },
    attention: { bg: "bg-orange-100",  text: "text-orange-600",  label: "ATENÇÃO"  },
    ok:        { bg: "bg-emerald-100", text: "text-emerald-700", label: "OK"       },
    excess:    { bg: "bg-purple-100",  text: "text-purple-700",  label: "EXCESSO"  },
    stopped:   { bg: "bg-[#0F1E3C]/6",text: "text-[#0F1E3C]/40",label: "PARADO"   },
  }
  const c = cfg[priority]
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {c.label}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MetricasPage() {
  const [data, setData]         = useState<MetricsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState("")

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

  const { products, notices, stats, daysToNext } = useMemo(() => {
    if (!data) return { products: [], notices: { urgent: [], attention: [], excess: [] }, stats: { urgent:0, attention:0, ok:0, totalProd:0 }, daysToNext: 0 }

    // Group by product → then by color
    const map = new Map<string, { name: string; variants: VariantMetric[] }>()
    for (const v of data.variants) {
      if (!map.has(v.productId)) map.set(v.productId, { name: v.productName, variants: [] })
      map.get(v.productId)!.variants.push(v)
    }

    const products = [...map.entries()]
      .map(([productId, g]) => {
        const worst = worstPriority(g.variants.map(v => v.priority))
        // Group by color
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
    const urgent     = data.variants.filter(v => v.priority === "urgent")
    const attention  = data.variants.filter(v => v.priority === "attention")
    const excessStop = data.variants.filter(v => v.priority === "excess" || v.priority === "stopped")

    // Stats
    const stats = {
      urgent:    urgent.length,
      attention: attention.length,
      ok:        data.variants.filter(v => v.priority === "ok").length,
      totalProd: data.variants.reduce((s, v) => s + v.suggestedProduction, 0),
    }

    const daysToNext = daysUntilNext(data.currentSeg, data.currentDay, data.currentYr, data.currentMo)

    return { products, notices: { urgent, attention, excess: excessStop }, stats, daysToNext }
  }, [data])

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

  return (
    <div className="space-y-5">

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
        <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors mt-1 flex-shrink-0">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Produzir agora",   value: stats.urgent,    accent: "text-red-600",    sub: "variações urgentes" },
          { label: "Em atenção",       value: stats.attention, accent: "text-orange-500",  sub: "monitorar de perto" },
          { label: "Em dia",           value: stats.ok,        accent: "text-emerald-600", sub: "sem ação necessária" },
          { label: "Produção sugerida",value: `${stats.totalProd} pç`, accent: "text-[#4361EE]", sub: "total urgentes + atenção" },
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

          {/* Produzir agora */}
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

          {/* Monitorar */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
              <p className="text-xs font-bold text-[#0F1E3C]">Monitorar</p>
            </div>
            {notices.attention.length === 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={13} />
                <p className="text-xs">Nada em alerta</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notices.attention.map(v => (
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

          {/* Excesso / Parado */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-400 flex-shrink-0" />
              <p className="text-xs font-bold text-[#0F1E3C]">Excesso / Parado</p>
            </div>
            {notices.excess.length === 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={13} />
                <p className="text-xs">Giro saudável</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notices.excess.map(v => (
                  <div key={v.variantId} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3C] truncate">{v.productName}</p>
                      <p className="text-xs text-[#0F1E3C]/40">{v.color} · {v.size}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-purple-600 font-semibold">
                        {v.priority === "stopped" ? "sem saída" : fmtDays(v.daysCurrent)}
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

      {/* Product cards */}
      {products.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-[#0F1E3C]/25">
          <Package size={40} strokeWidth={1.2} />
          <p className="text-sm">Nenhuma variação ativa com controle de estoque.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map(product => (
            <div key={product.productId} className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">

              {/* Product header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#0F1E3C]/6">
                <div>
                  <p className="font-bold text-[#0F1E3C]">{product.productName}</p>
                  <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                    {product.totalStock} pç em estoque · {product.totalSales30d} vendas 30d
                  </p>
                </div>
                <PriorityBadge priority={product.worstPriority} />
              </div>

              {/* Column labels */}
              <div className="grid items-center px-5 py-2 bg-[#F9FAFB] border-b border-[#0F1E3C]/5"
                style={{ gridTemplateColumns: "2rem 5rem 1fr 5rem 5rem 6rem 2.5rem 4rem" }}>
                {["TAM", "ESTOQUE", "GIRO ATUAL", "MÊS ANT.", "DURA", "TENDÊNCIA", "", ""].map((h, i) => (
                  <p key={i} className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/25">{h}</p>
                ))}
              </div>

              {/* Color groups + variant rows */}
              {product.colorGroups.map(([color, variants]) => (
                <div key={color}>
                  {/* Color header */}
                  <div className="flex items-center gap-2 px-5 py-2 bg-[#F4F6FB] border-b border-[#0F1E3C]/6">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#0F1E3C]/30" />
                    <p className="text-xs font-bold text-[#0F1E3C]/50">{color || "Sem cor"}</p>
                  </div>
                  {/* Variant rows */}
                  {variants.map((v, idx) => (
                    <div
                      key={v.variantId}
                      className={`grid items-center px-5 py-3 hover:bg-[#F9FAFB] transition-colors ${idx < variants.length - 1 ? "border-b border-[#0F1E3C]/4" : ""}`}
                      style={{ gridTemplateColumns: "2rem 5rem 1fr 5rem 5rem 6rem 2.5rem 4rem" }}
                    >
                      {/* Tamanho */}
                      <p className="text-sm font-black text-[#0F1E3C]">{v.size || "—"}</p>

                      {/* Estoque */}
                      <span className={`text-sm font-bold inline-flex items-center ${
                        v.currentStock === 0              ? "text-red-600"    :
                        v.currentStock <= v.minStock      ? "text-orange-500" :
                                                            "text-[#0F1E3C]"
                      }`}>
                        {v.currentStock} pç
                      </span>

                      {/* Giro atual */}
                      <p className="text-sm font-semibold text-[#0F1E3C]">
                        {v.velocityCurrent > 0 ? `${v.velocityCurrent.toFixed(1)} pç/dia` : "—"}
                      </p>

                      {/* Mês anterior */}
                      <p className="text-sm text-[#0F1E3C]/45">
                        {v.velocityPrevMonth > 0 ? `${v.velocityPrevMonth.toFixed(1)}/dia` : "—"}
                      </p>

                      {/* Dura */}
                      <p className={`text-sm ${daysColor(v.daysCurrent)}`}>{fmtDays(v.daysCurrent)}</p>

                      {/* Tendência */}
                      <TrendChip pct={v.trendPct} />

                      {/* Padrão bars */}
                      <PatternBars pattern={v.pattern} currentSeg={data.currentSeg} />

                      {/* Produção sugerida */}
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
          ))}
        </div>
      )}

    </div>
  )
}
