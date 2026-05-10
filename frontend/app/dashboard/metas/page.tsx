"use client"

import { useEffect, useState } from "react"
import MetricCard from "@/components/cards/MetricCard"
import { calcInventoryMetrics, calcMonthlyOperationalCost, formatCurrency, type BalanceRow } from "@/lib/calculations"
import type { OperationalCost, InventoryMetric } from "@/lib/types"

const statusLabel: Record<string, string> = {
  urgent: "Urgente", attention: "Atenção", healthy: "Saudável", excess: "Excesso", stopped: "Parado",
}
const statusClass: Record<string, string> = {
  urgent:    "bg-red-100 text-red-700",
  attention: "bg-amber-100 text-amber-700",
  healthy:   "bg-emerald-100 text-emerald-700",
  excess:    "bg-gray-100 text-gray-600",
  stopped:   "bg-purple-100 text-purple-700",
}

export default function MetasPage() {
  const [balance, setBalance] = useState<BalanceRow[]>([])
  const [costs, setCosts] = useState<OperationalCost[]>([])
  const [metrics, setMetrics] = useState<InventoryMetric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/stock/balance").then((r) => r.json()),
      fetch("/api/operational-costs").then((r) => r.json()),
    ]).then(([bal, cost]) => {
      const b: BalanceRow[] = Array.isArray(bal) ? bal : []
      const c: OperationalCost[] = Array.isArray(cost) ? cost : []
      setBalance(b)
      setCosts(c)
      setMetrics(calcInventoryMetrics(b, calcMonthlyOperationalCost(c)))
    }).finally(() => setLoading(false))
  }, [])

  const opCost   = calcMonthlyOperationalCost(costs)
  const avgProfit = balance.length > 0
    ? balance.reduce((a, v) => a + (Number(v.salePrice) - Number(v.averageCost)), 0) / balance.length
    : 0
  const breakeven = avgProfit > 0 ? Math.ceil(opCost / avgProfit) : 0

  const urgent   = metrics.filter((m) => m.status === "urgent")
  const stopped  = metrics.filter((m) => m.status === "stopped")
  const toMake   = metrics.filter((m) => m.suggestedProduction > 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Metas de Produção</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">O que produzir, quanto e com qual prioridade</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Custo op. mensal"  value={formatCurrency(opCost)}     color="blue" />
        <MetricCard title="Lucro médio/peça"  value={formatCurrency(avgProfit)}   color="green" />
        <MetricCard title="Ponto equilíbrio"  value={`${breakeven} peças/mês`}   />
        <MetricCard title="Urgências"          value={urgent.length}               color={urgent.length > 0 ? "red" : "default"} />
      </div>

      {/* Sugestão de produção */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
          <h2 className="text-sm font-bold text-[#0F1E3C]">Sugestão de produção</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0F1E3C]/5">
              {["Variação", "Estoque", "Vendas 30d", "Média/dia", "Dias rest.", "Lucro/un.", "Produzir", "Status"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0F1E3C]/4">
            {metrics.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhuma variação cadastrada</td></tr>
            ) : [...metrics].sort((a, b) => {
              const order = { urgent: 0, attention: 1, stopped: 2, healthy: 3, excess: 4 }
              return (order[a.status] ?? 5) - (order[b.status] ?? 5)
            }).map((m) => (
              <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                <td className="px-4 py-3 font-semibold text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                <td className="px-4 py-3 text-[#0F1E3C]/65">{m.currentStock}</td>
                <td className="px-4 py-3 text-[#0F1E3C]/65">{m.salesLast30Days}</td>
                <td className="px-4 py-3 text-[#0F1E3C]/65">{m.avgDailySales.toFixed(1)}</td>
                <td className="px-4 py-3 text-[#0F1E3C]/65">{m.stockDaysRemaining?.toFixed(0) ?? "∞"}</td>
                <td className="px-4 py-3 text-emerald-600 font-semibold">{formatCurrency(m.unitProfit)}</td>
                <td className="px-4 py-3 font-bold text-[#4361EE]">{m.suggestedProduction > 0 ? `+${m.suggestedProduction}` : "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusClass[m.status]}`}>
                    {statusLabel[m.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Produtos parados */}
      {stopped.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Produtos parados <span className="text-[#0F1E3C]/40 font-normal">— sem venda nos últimos 30 dias</span></h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                {["Variação", "SKU", "Estoque atual", "Lucro potencial/un."].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {stopped.map((m) => (
                <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-3 font-mono text-xs text-[#0F1E3C]/50">{m.sku}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{m.currentStock}</td>
                  <td className="px-5 py-3 text-emerald-600">{formatCurrency(m.unitProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
