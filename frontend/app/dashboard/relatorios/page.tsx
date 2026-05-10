"use client"

import { useEffect, useState } from "react"
import { calcInventoryMetrics, calcMonthlyOperationalCost, formatCurrency, type BalanceRow } from "@/lib/calculations"
import type { OperationalCost } from "@/lib/types"

export default function RelatoriosPage() {
  const [balance, setBalance] = useState<BalanceRow[]>([])
  const [costs, setCosts] = useState<OperationalCost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/stock/balance").then((r) => r.json()),
      fetch("/api/operational-costs").then((r) => r.json()),
    ]).then(([bal, cost]) => {
      setBalance(Array.isArray(bal) ? bal : [])
      setCosts(Array.isArray(cost) ? cost : [])
    }).finally(() => setLoading(false))
  }, [])

  const opCost  = calcMonthlyOperationalCost(costs)
  const metrics = calcInventoryMetrics(balance, opCost)

  const byProduct = Object.values(
    balance.reduce((acc, b) => {
      const key = b.productName
      if (!acc[key]) acc[key] = { name: key, variants: 0, totalStock: 0, salesLast30Days: 0 }
      acc[key].variants++
      acc[key].totalStock += b.currentStock
      acc[key].salesLast30Days += b.salesLast30Days
      return acc
    }, {} as Record<string, { name: string; variants: number; totalStock: number; salesLast30Days: number }>)
  ).sort((a, b) => b.salesLast30Days - a.salesLast30Days)

  const lowStock = metrics
    .filter((m) => m.status === "urgent" || m.status === "attention")
    .sort((a, b) => (a.stockDaysRemaining ?? 999) - (b.stockDaysRemaining ?? 999))

  const stopped = metrics.filter((m) => m.status === "stopped")

  const marginData = [...metrics]
    .sort((a, b) => b.unitProfit - a.unitProfit)
    .slice(0, 10)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function Table({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
    return (
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
          <h2 className="text-sm font-bold text-[#0F1E3C]">{title}</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0F1E3C]/5">
              {headers.map((h) => (
                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0F1E3C]/4">
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="py-8 text-center text-sm text-[#0F1E3C]/30">Sem dados</td></tr>
            ) : rows.map((row, i) => (
              <tr key={i} className="hover:bg-[#F4F6FB] transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="px-5 py-2.5 text-[#0F1E3C]/70">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Relatórios</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Visão consolidada de desempenho e estoque</p>
      </div>

      <Table
        title="Produtos mais vendidos — últimos 30 dias"
        headers={["Produto", "Variações", "Estoque total", "Vendas 30d"]}
        rows={byProduct.map((p) => [p.name, p.variants, p.totalStock, p.salesLast30Days])}
      />

      <Table
        title="Estoque baixo — ação necessária"
        headers={["Variação", "SKU", "Estoque", "Dias rest."]}
        rows={lowStock.map((m) => [
          `${m.productName} ${m.color} ${m.size}`,
          m.sku,
          m.currentStock,
          m.stockDaysRemaining?.toFixed(0) ?? "—",
        ])}
      />

      <Table
        title="Estoque parado"
        headers={["Variação", "SKU", "Estoque", "Lucro/un."]}
        rows={stopped.map((m) => [
          `${m.productName} ${m.color} ${m.size}`,
          m.sku,
          m.currentStock,
          formatCurrency(m.unitProfit),
        ])}
      />

      <Table
        title="Margem por variação"
        headers={["Variação", "Preço venda", "Custo médio", "Lucro/un.", "Margem"]}
        rows={marginData.map((m) => {
          const bal = balance.find((b) => b.variantId === m.variantId)
          const price  = bal ? Number(bal.salePrice) : 0
          const cost   = bal ? Number(bal.averageCost) : 0
          const margin = price > 0 ? ((price - cost) / price * 100).toFixed(1) + "%" : "—"
          return [
            `${m.productName} ${m.color} ${m.size}`,
            formatCurrency(price),
            formatCurrency(cost),
            formatCurrency(m.unitProfit),
            margin,
          ]
        })}
      />

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F1E3C] mb-4">Custo operacional por categoria</h2>
        {costs.filter((c) => c.active).length === 0 ? (
          <p className="text-sm text-[#0F1E3C]/30 text-center py-4">Nenhum custo cadastrado</p>
        ) : (
          <div className="space-y-2">
            {costs.filter((c) => c.active).map((c) => {
              const pct = opCost > 0 ? (Number(c.monthlyValue) / opCost * 100) : 0
              return (
                <div key={c.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[#0F1E3C]/70">{c.name}</span>
                    <span className="font-semibold text-[#0F1E3C]">{formatCurrency(Number(c.monthlyValue))}</span>
                  </div>
                  <div className="h-1.5 bg-[#F4F6FB] rounded-full overflow-hidden">
                    <div className="h-full bg-[#4361EE] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between text-sm font-black pt-2 border-t border-[#0F1E3C]/6">
              <span className="text-[#0F1E3C]">Total</span>
              <span className="text-[#4361EE]">{formatCurrency(opCost)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
