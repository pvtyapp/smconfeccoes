import type { InventoryMetric } from "./types"

// Custo único (PIV 05/11): vale sempre o "Custo" cadastrado em Produtos
// (products.material_cost) — o mesmo que o Relatório Financeiro já usava. O
// average_cost da variante era alimentado pela Produção (parada desde 03/09, saiu
// do painel) e misturava custo de costura e fechamentos antigos, então o "valor em
// estoque" não batia com o financeiro. O parâmetro fica só pra não mexer nas chamadas.
export function effectiveCost(_averageCost: number | string, costPrice: number | string): number {
  return Number(costPrice) || 0
}

export type BalanceRow = {
  variantId: string
  productId: string
  productName: string
  color: string
  size: string
  sku: string
  minStock: number
  targetStock: number
  salePrice: number
  averageCost: number
  costPrice: number   // material_cost do produto
  currentStock: number
  salesLast30Days: number
  qtyReservedPending: number
  qtyReservedNotified: number
}

export function calcInventoryMetrics(
  rows: BalanceRow[],
  operationalCost: number
): InventoryMetric[] {
  return rows.map((v) => {
    const avgDailySales = v.salesLast30Days / 30
    const stockDaysRemaining = avgDailySales > 0 ? v.currentStock / avgDailySales : null
    const unitProfit = Number(v.salePrice) - effectiveCost(v.averageCost, v.costPrice)

    let status: InventoryMetric["status"] = "healthy"
    let suggestedProduction = 0

    if (v.salesLast30Days === 0 && v.currentStock >= 0) {
      status = "stopped"
    } else if (stockDaysRemaining !== null && stockDaysRemaining <= 7) {
      status = "urgent"
      suggestedProduction = Math.max(0, v.targetStock - v.currentStock)
    } else if (stockDaysRemaining !== null && stockDaysRemaining <= 15) {
      status = "attention"
      suggestedProduction = Math.max(0, v.targetStock - v.currentStock)
    } else if (stockDaysRemaining !== null && stockDaysRemaining > 60 && v.currentStock > v.targetStock) {
      status = "excess"
    }

    return {
      variantId: v.variantId,
      productName: v.productName,
      color: v.color,
      size: v.size,
      sku: v.sku,
      currentStock: v.currentStock,
      salesLast30Days: v.salesLast30Days,
      avgDailySales,
      stockDaysRemaining,
      unitProfit,
      suggestedProduction,
      status,
    }
  })
}

export function calcMonthlyOperationalCost(costs: { active: boolean; monthlyValue: number }[]): number {
  return costs.filter((c) => c.active).reduce((acc, c) => acc + Number(c.monthlyValue), 0)
}

export function calcProductionCost(params: {
  fabricKg: number
  fabricCostPerKg: number
  sewingCostPerPiece: number
  threadCost: number
  packagingCost: number
  otherCosts: number
  totalQuantity: number
  salePrice: number
}) {
  const totalFabric  = params.fabricKg * params.fabricCostPerKg
  const totalSewing  = params.totalQuantity * params.sewingCostPerPiece
  const totalCost    = totalFabric + totalSewing + params.threadCost + params.packagingCost + params.otherCosts
  const unitCost     = params.totalQuantity > 0 ? totalCost / params.totalQuantity : 0
  const unitProfit   = params.salePrice - unitCost
  const marginPercent = params.salePrice > 0 ? (unitProfit / params.salePrice) * 100 : 0

  return { totalFabric, totalSewing, totalCost, unitCost, unitProfit, marginPercent }
}

export function formatCurrency(value: number): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
