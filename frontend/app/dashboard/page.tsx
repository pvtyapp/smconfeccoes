"use client"

import MetricCard from "@/components/cards/MetricCard"
import { MOCK_PRODUCTS, MOCK_VARIANTS, MOCK_STOCK_MOVEMENTS, MOCK_OPERATIONAL_COSTS } from "@/lib/mock-data"
import { calcCurrentStock, calcMonthlyOperationalCost, calcInventoryMetrics, formatCurrency } from "@/lib/calculations"
import { Badge } from "@/components/ui/badge"

export default function DashboardPage() {
  const movements = MOCK_STOCK_MOVEMENTS
  const totalStock = MOCK_VARIANTS.reduce((acc, v) => acc + calcCurrentStock(v.id, movements), 0)
  const opCost = calcMonthlyOperationalCost(MOCK_OPERATIONAL_COSTS)
  const metrics = calcInventoryMetrics(MOCK_VARIANTS, movements, opCost)
  const critical = metrics.filter((m) => m.status === "urgent" || m.status === "attention")
  const stopped = metrics.filter((m) => m.status === "stopped")

  const statusLabel: Record<string, string> = {
    urgent: "Urgente",
    attention: "Atenção",
    healthy: "Saudável",
    excess: "Excesso",
    stopped: "Parado",
  }
  const statusColor: Record<string, string> = {
    urgent: "bg-red-100 text-red-700",
    attention: "bg-yellow-100 text-yellow-700",
    healthy: "bg-green-100 text-green-700",
    excess: "bg-gray-100 text-gray-600",
    stopped: "bg-purple-100 text-purple-700",
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visão geral da SM Confecções</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Produtos cadastrados" value={MOCK_PRODUCTS.length} />
        <MetricCard title="Variações" value={MOCK_VARIANTS.length} />
        <MetricCard title="Estoque total" value={totalStock + " peças"} />
        <MetricCard title="Custo operacional/mês" value={formatCurrency(opCost)} color="blue" />
        <MetricCard title="Variações críticas" value={critical.length} color={critical.length > 0 ? "red" : "default"} />
        <MetricCard title="Produtos parados" value={stopped.length} color={stopped.length > 0 ? "yellow" : "default"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Estoque crítico</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs border-b">
                <th className="pb-2">Variação</th>
                <th className="pb-2">Estoque</th>
                <th className="pb-2">Dias rest.</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {critical.map((m) => (
                <tr key={m.variantId}>
                  <td className="py-2 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="py-2 text-gray-600">{m.currentStock}</td>
                  <td className="py-2 text-gray-600">{m.stockDaysRemaining?.toFixed(0) ?? "—"}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[m.status]}`}>
                      {statusLabel[m.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {critical.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-gray-400">Nenhuma variação crítica</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Sugestão de produção</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs border-b">
                <th className="pb-2">Variação</th>
                <th className="pb-2">Produzir</th>
                <th className="pb-2">Lucro un.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metrics.filter((m) => m.suggestedProduction > 0).slice(0, 6).map((m) => (
                <tr key={m.variantId}>
                  <td className="py-2 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="py-2 text-blue-700 font-semibold">+{m.suggestedProduction}</td>
                  <td className="py-2 text-green-700">{formatCurrency(m.unitProfit)}</td>
                </tr>
              ))}
              {metrics.filter((m) => m.suggestedProduction > 0).length === 0 && (
                <tr><td colSpan={3} className="py-4 text-center text-gray-400">Estoque adequado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
