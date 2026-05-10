"use client"

import { storageGet } from "@/lib/storage"
import { MOCK_VARIANTS, MOCK_STOCK_MOVEMENTS, MOCK_OPERATIONAL_COSTS } from "@/lib/mock-data"
import type { ProductVariant, StockMovement, OperationalCost } from "@/lib/types"
import { calcInventoryMetrics, calcMonthlyOperationalCost, formatCurrency } from "@/lib/calculations"
import MetricCard from "@/components/cards/MetricCard"

function getVariants(): ProductVariant[] { return storageGet<ProductVariant[]>("variants") ?? MOCK_VARIANTS }
function getMovements(): StockMovement[] { return storageGet<StockMovement[]>("movements") ?? MOCK_STOCK_MOVEMENTS }
function getCosts(): OperationalCost[] { return storageGet<OperationalCost[]>("opcosts") ?? MOCK_OPERATIONAL_COSTS }

const statusLabel: Record<string, string> = { urgent: "Urgente", attention: "Atenção", healthy: "Saudável", excess: "Excesso", stopped: "Parado" }
const statusColor: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  attention: "bg-yellow-100 text-yellow-700",
  healthy: "bg-green-100 text-green-700",
  excess: "bg-gray-100 text-gray-600",
  stopped: "bg-purple-100 text-purple-700",
}

export default function MetasPage() {
  const variants = getVariants()
  const movements = getMovements()
  const costs = getCosts()
  const opCost = calcMonthlyOperationalCost(costs)
  const metrics = calcInventoryMetrics(variants, movements, opCost)

  const avgUnitProfit = metrics.reduce((a, m) => a + m.unitProfit, 0) / (metrics.length || 1)
  const breakEven = avgUnitProfit > 0 ? Math.ceil(opCost / avgUnitProfit) : 0
  const projectedProfit = metrics.reduce((a, m) => a + m.salesLast30Days * m.unitProfit, 0)
  const urgent = metrics.filter((m) => m.status === "urgent").length
  const stopped = metrics.filter((m) => m.status === "stopped")

  const sorted = [...metrics].sort((a, b) => {
    const score = (m: typeof a) => m.salesLast30Days * 2 + m.unitProfit * 1.5 - m.currentStock * 0.5
    return score(b) - score(a)
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Metas de Produção</h1>
        <p className="text-sm text-gray-500">Inteligência de produção baseada em giro e estoque</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Custo operacional/mês" value={formatCurrency(opCost)} color="blue" />
        <MetricCard title="Lucro projetado (30d)" value={formatCurrency(projectedProfit)} color="green" />
        <MetricCard title="Ponto de equilíbrio" value={`${breakEven} peças/mês`} />
        <MetricCard title="Variações urgentes" value={urgent} color={urgent > 0 ? "red" : "default"} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Sugestão de produção — por prioridade</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Estoque</th>
                <th className="text-left px-5 py-3">Vendas 30d</th>
                <th className="text-left px-5 py-3">Média/dia</th>
                <th className="text-left px-5 py-3">Dias rest.</th>
                <th className="text-left px-5 py-3">Lucro un.</th>
                <th className="text-left px-5 py-3">Produzir</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((m) => (
                <tr key={m.variantId} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-3 text-gray-700">{m.currentStock}</td>
                  <td className="px-5 py-3 text-gray-600">{m.salesLast30Days}</td>
                  <td className="px-5 py-3 text-gray-600">{m.avgDailySales.toFixed(1)}</td>
                  <td className="px-5 py-3 text-gray-600">{m.stockDaysRemaining !== null ? m.stockDaysRemaining.toFixed(0) : "—"}</td>
                  <td className="px-5 py-3 text-green-700 font-medium">{formatCurrency(m.unitProfit)}</td>
                  <td className="px-5 py-3 font-bold text-blue-700">{m.suggestedProduction > 0 ? `+${m.suggestedProduction}` : "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[m.status]}`}>
                      {statusLabel[m.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {stopped.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Produtos parados — sem giro</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Estoque</th>
                <th className="text-left px-5 py-3">Vendas 30d</th>
                <th className="text-left px-5 py-3">Lucro un.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stopped.map((m) => (
                <tr key={m.variantId} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-3 text-gray-600">{m.currentStock}</td>
                  <td className="px-5 py-3 text-gray-500">0</td>
                  <td className="px-5 py-3 text-green-700">{formatCurrency(m.unitProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
