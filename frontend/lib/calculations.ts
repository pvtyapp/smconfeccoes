import type { StockMovement, ProductVariant, InventoryMetric } from "./types"
import { MOCK_SALES_30D } from "./mock-data"

export function calcCurrentStock(variantId: string, movements: StockMovement[]): number {
  return movements
    .filter((m) => m.variantId === variantId)
    .reduce((acc, m) => (m.type === "in" ? acc + m.quantity : acc - m.quantity), 0)
}

export function calcMonthlyOperationalCost(costs: { active: boolean; monthlyValue: number }[]): number {
  return costs.filter((c) => c.active).reduce((acc, c) => acc + c.monthlyValue, 0)
}

export function calcInventoryMetrics(
  variants: ProductVariant[],
  movements: StockMovement[],
  operationalCost: number
): InventoryMetric[] {
  return variants.map((v) => {
    const currentStock = calcCurrentStock(v.id, movements)
    const salesLast30Days = MOCK_SALES_30D[v.id] ?? 0
    const avgDailySales = salesLast30Days / 30
    const stockDaysRemaining = avgDailySales > 0 ? currentStock / avgDailySales : null
    const unitProfit = v.salePrice - v.averageCost

    let status: InventoryMetric["status"] = "healthy"
    let suggestedProduction = 0

    if (salesLast30Days === 0 && currentStock > 0) {
      status = "stopped"
    } else if (salesLast30Days === 0 && currentStock === 0) {
      status = "stopped"
    } else if (stockDaysRemaining !== null && stockDaysRemaining <= 7) {
      status = "urgent"
      suggestedProduction = Math.max(0, v.targetStock - currentStock)
    } else if (stockDaysRemaining !== null && stockDaysRemaining <= 15) {
      status = "attention"
      suggestedProduction = Math.max(0, v.targetStock - currentStock)
    } else if (stockDaysRemaining !== null && stockDaysRemaining > 60 && currentStock > v.targetStock) {
      status = "excess"
    }

    return {
      variantId: v.id,
      productName: v.productName,
      color: v.color,
      size: v.size,
      sku: v.sku,
      currentStock,
      salesLast30Days,
      avgDailySales,
      stockDaysRemaining,
      unitProfit,
      suggestedProduction,
      status,
    }
  })
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
  const totalFabric = params.fabricKg * params.fabricCostPerKg
  const totalSewing = params.totalQuantity * params.sewingCostPerPiece
  const totalCost = totalFabric + totalSewing + params.threadCost + params.packagingCost + params.otherCosts
  const unitCost = params.totalQuantity > 0 ? totalCost / params.totalQuantity : 0
  const unitProfit = params.salePrice - unitCost
  const marginPercent = params.salePrice > 0 ? (unitProfit / params.salePrice) * 100 : 0

  return { totalFabric, totalSewing, totalCost, unitCost, unitProfit, marginPercent }
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
