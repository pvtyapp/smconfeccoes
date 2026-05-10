"use client"

import { storageGet } from "@/lib/storage"
import { MOCK_VARIANTS, MOCK_STOCK_MOVEMENTS, MOCK_OPERATIONAL_COSTS } from "@/lib/mock-data"
import type { ProductVariant, StockMovement, OperationalCost } from "@/lib/types"
import { calcInventoryMetrics, calcMonthlyOperationalCost, formatCurrency } from "@/lib/calculations"

function getVariants(): ProductVariant[] { return storageGet<ProductVariant[]>("variants") ?? MOCK_VARIANTS }
function getMovements(): StockMovement[] { return storageGet<StockMovement[]>("movements") ?? MOCK_STOCK_MOVEMENTS }
function getCosts(): OperationalCost[] { return storageGet<OperationalCost[]>("opcosts") ?? MOCK_OPERATIONAL_COSTS }

export default function RelatoriosPage() {
  const variants = getVariants()
  const movements = getMovements()
  const costs = getCosts()
  const opCost = calcMonthlyOperationalCost(costs)
  const metrics = calcInventoryMetrics(variants, movements, opCost)

  const byGiro = [...metrics].sort((a, b) => b.salesLast30Days - a.salesLast30Days)
  const byMargin = [...metrics].sort((a, b) => b.unitProfit - a.unitProfit)
  const critical = metrics.filter((m) => m.status === "urgent" || m.status === "attention")
  const stopped = metrics.filter((m) => m.status === "stopped" || m.status === "excess")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Relatórios</h1>
        <p className="text-sm text-gray-500">Indicadores e análise de desempenho</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Maior giro (30 dias)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Vendas 30d</th>
                <th className="text-left px-5 py-3">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byGiro.map((m) => (
                <tr key={m.variantId} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-2.5 font-semibold text-blue-700">{m.salesLast30Days}</td>
                  <td className="px-5 py-2.5 text-green-700">{formatCurrency(m.unitProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Maior margem por peça</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Lucro/peça</th>
                <th className="text-left px-5 py-3">Custo médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byMargin.map((m) => {
                const v = variants.find((x) => x.id === m.variantId)
                return (
                  <tr key={m.variantId} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                    <td className="px-5 py-2.5 font-semibold text-green-700">{formatCurrency(m.unitProfit)}</td>
                    <td className="px-5 py-2.5 text-gray-500">{v ? formatCurrency(v.averageCost) : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Estoque baixo / urgente</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Estoque</th>
                <th className="text-left px-5 py-3">Dias rest.</th>
                <th className="text-left px-5 py-3">Produzir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {critical.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-center text-gray-400">Nenhum crítico</td></tr>}
              {critical.map((m) => (
                <tr key={m.variantId} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-2.5 text-red-700 font-semibold">{m.currentStock}</td>
                  <td className="px-5 py-2.5 text-gray-600">{m.stockDaysRemaining?.toFixed(0) ?? "—"}</td>
                  <td className="px-5 py-2.5 text-blue-700 font-bold">+{m.suggestedProduction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Estoque parado / excesso</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Variação</th>
                <th className="text-left px-5 py-3">Estoque</th>
                <th className="text-left px-5 py-3">Vendas 30d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stopped.length === 0 && <tr><td colSpan={3} className="px-5 py-4 text-center text-gray-400">Nenhum parado</td></tr>}
              {stopped.map((m) => (
                <tr key={m.variantId} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{m.productName} {m.color} {m.size}</td>
                  <td className="px-5 py-2.5 text-gray-600">{m.currentStock}</td>
                  <td className="px-5 py-2.5 text-purple-700">{m.salesLast30Days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
