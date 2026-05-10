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

export default function DashboardPage() {
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
      const opCost = calcMonthlyOperationalCost(c)
      setBalance(b)
      setCosts(c)
      setMetrics(calcInventoryMetrics(b, opCost))
    }).finally(() => setLoading(false))
  }, [])

  const opCost      = calcMonthlyOperationalCost(costs)
  const totalStock  = balance.reduce((a, v) => a + v.currentStock, 0)
  const critical    = metrics.filter((m) => m.status === "urgent" || m.status === "attention")
  const stopped     = metrics.filter((m) => m.status === "stopped")
  const toProduced  = metrics.filter((m) => m.suggestedProduction > 0).slice(0, 6)

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
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
          Dashboard
        </h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Visão geral da SM Confecções</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard title="Estoque total"       value={`${totalStock} peças`} />
        <MetricCard title="Custo op./mês"       value={formatCurrency(opCost)} color="blue" />
        <MetricCard title="Variações ativas"    value={balance.length} />
        <MetricCard title="Variações críticas"  value={critical.length} color={critical.length > 0 ? "red" : "default"} />
        <MetricCard title="Produtos parados"    value={stopped.length} color={stopped.length > 0 ? "purple" : "default"} />
        <MetricCard title="Sugestões produção"  value={toProduced.length} color={toProduced.length > 0 ? "yellow" : "default"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Estoque crítico</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Variação</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Estoque</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Dias rest.</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {critical.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-sm text-[#0F1E3C]/30">Nenhuma variação crítica</td></tr>
              ) : critical.map((m) => (
                <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-medium text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{m.currentStock}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{m.stockDaysRemaining?.toFixed(0) ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusClass[m.status]}`}>
                      {statusLabel[m.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Sugestão de produção</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Variação</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Produzir</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">Lucro/un.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {toProduced.length === 0 ? (
                <tr><td colSpan={3} className="py-8 text-center text-sm text-[#0F1E3C]/30">Estoque adequado</td></tr>
              ) : toProduced.map((m) => (
                <tr key={m.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-medium text-[#0F1E3C]">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-3 font-bold text-[#4361EE]">+{m.suggestedProduction}</td>
                  <td className="px-5 py-3 text-emerald-600 font-semibold">{formatCurrency(m.unitProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
