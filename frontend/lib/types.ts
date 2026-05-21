export type Category = {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export type Product = {
  id: string
  name: string
  categoryId?: string | null
  description?: string
  salePrice: number
  costPrice: number
  sizes: string[]
  colors: string[]
  status: "active" | "inactive"
  chatbotEnabled: boolean
  createdAt: string
}

export type ProductVariant = {
  id: string
  productId: string
  productName: string
  color: string
  size: string
  sku: string
  salePrice: number
  averageCost: number
  minStock: number
  targetStock: number
  status: "active" | "inactive"
}

export type StockMovement = {
  id: string
  variantId: string
  type: "in" | "out"
  quantity: number
  reason: string
  channel?: "atacado" | "varejo" | "pdv" | "manual" | "producao"
  notes?: string
  createdAt: string
}

export type OperationalCost = {
  id: string
  name: string
  category: string
  type: "fixed" | "variable"
  monthlyValue: number
  active: boolean
  notes?: string
}

export type ProductionOrderItem = {
  variantId: string
  quantity: number
}

export type ProductionOrder = {
  id: string
  productId: string
  items: ProductionOrderItem[]
  fabricKg: number
  fabricCostPerKg: number
  sewingCostPerPiece: number
  threadCost: number
  packagingCost: number
  otherCosts: number
  totalQuantity: number
  totalCost: number
  unitCost: number
  notes?: string
  createdAt: string
}

export type InventoryMetric = {
  variantId: string
  productName: string
  color: string
  size: string
  sku: string
  currentStock: number
  salesLast30Days: number
  avgDailySales: number
  stockDaysRemaining: number | null
  unitProfit: number
  suggestedProduction: number
  status: "urgent" | "attention" | "healthy" | "excess" | "stopped"
}

export type AuthSession = {
  email: string
  role: "admin" | "estoque" | "pdv"
  name: string
  company: string
}
