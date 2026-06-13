import type { Product, ProductVariant, StockMovement, OperationalCost } from "./types"

export const MOCK_PRODUCTS: Product[] = [
  { id: "p1", name: "Camiseta Básica", description: "Camiseta básica 100% algodão", salePrice: 39.9, costPrice: 15.9, sizes: ["P","M","G","GG"], colors: ["Preto","Branco"], status: "active", chatbotEnabled: false, stockEnabled: false, precoPorMetro: false, createdAt: "2024-01-10" },
  { id: "p2", name: "Moletom Canguru", description: "Moletom canguru com bolso frontal", salePrice: 89.9, costPrice: 42.0, sizes: ["P","M","G"], colors: ["Preto"], status: "active", chatbotEnabled: false, stockEnabled: false, precoPorMetro: false, createdAt: "2024-01-10" },
  { id: "p3", name: "Calça Moletom", description: "Calça de moletom com elástico", salePrice: 79.9, costPrice: 35.0, sizes: ["P","M","G","GG"], colors: ["Preto","Cinza"], status: "active", chatbotEnabled: false, stockEnabled: false, precoPorMetro: false, createdAt: "2024-01-15" },
  { id: "p4", name: "Bermuda Moletom", description: "Bermuda de moletom", salePrice: 59.9, costPrice: 24.0, sizes: ["P","M","G"], colors: ["Preto","Branco","Cinza"], status: "active", chatbotEnabled: false, stockEnabled: false, precoPorMetro: false, createdAt: "2024-01-15" },
]

export const MOCK_VARIANTS: ProductVariant[] = [
  { id: "v1", productId: "p1", productName: "Camiseta Básica", color: "Preta", size: "P", sku: "CAM-PRETA-P", salePrice: 39.9, averageCost: 15.9, minStock: 20, targetStock: 80, status: "active" },
  { id: "v2", productId: "p1", productName: "Camiseta Básica", color: "Preta", size: "M", sku: "CAM-PRETA-M", salePrice: 39.9, averageCost: 15.9, minStock: 20, targetStock: 80, status: "active" },
  { id: "v3", productId: "p1", productName: "Camiseta Básica", color: "Preta", size: "G", sku: "CAM-PRETA-G", salePrice: 39.9, averageCost: 15.9, minStock: 20, targetStock: 80, status: "active" },
  { id: "v4", productId: "p1", productName: "Camiseta Básica", color: "Branca", size: "M", sku: "CAM-BRANCA-M", salePrice: 39.9, averageCost: 15.9, minStock: 20, targetStock: 80, status: "active" },
  { id: "v5", productId: "p2", productName: "Moletom Canguru", color: "Preto", size: "M", sku: "MOL-PRETO-M", salePrice: 89.9, averageCost: 42.0, minStock: 10, targetStock: 60, status: "active" },
  { id: "v6", productId: "p2", productName: "Moletom Canguru", color: "Preto", size: "G", sku: "MOL-PRETO-G", salePrice: 89.9, averageCost: 42.0, minStock: 10, targetStock: 60, status: "active" },
]

export const MOCK_STOCK_MOVEMENTS: StockMovement[] = [
  { id: "sm1", variantId: "v1", type: "in", quantity: 50, reason: "producao", channel: "producao", createdAt: "2024-01-10" },
  { id: "sm2", variantId: "v2", type: "in", quantity: 80, reason: "producao", channel: "producao", createdAt: "2024-01-10" },
  { id: "sm3", variantId: "v2", type: "out", quantity: 68, reason: "venda_manual", channel: "atacado", createdAt: "2024-02-01" },
  { id: "sm4", variantId: "v3", type: "in", quantity: 60, reason: "producao", channel: "producao", createdAt: "2024-01-10" },
  { id: "sm5", variantId: "v3", type: "out", quantity: 52, reason: "venda_manual", channel: "atacado", createdAt: "2024-02-01" },
  { id: "sm6", variantId: "v4", type: "in", quantity: 60, reason: "producao", channel: "producao", createdAt: "2024-01-10" },
  { id: "sm7", variantId: "v5", type: "in", quantity: 40, reason: "producao", channel: "producao", createdAt: "2024-01-15" },
  { id: "sm8", variantId: "v5", type: "out", quantity: 25, reason: "venda_manual", channel: "atacado", createdAt: "2024-02-01" },
  { id: "sm9", variantId: "v6", type: "in", quantity: 30, reason: "producao", channel: "producao", createdAt: "2024-01-15" },
  { id: "sm10", variantId: "v6", type: "out", quantity: 24, reason: "venda_manual", channel: "atacado", createdAt: "2024-02-01" },
]

export const MOCK_OPERATIONAL_COSTS: OperationalCost[] = [
  { id: "oc1", name: "Costureiras", category: "Costureiras", type: "fixed", monthlyValue: 12000, active: true },
  { id: "oc2", name: "Linhas e insumos", category: "Linhas", type: "variable", monthlyValue: 1500, active: true },
  { id: "oc3", name: "Energia elétrica", category: "Energia", type: "fixed", monthlyValue: 2000, active: true },
  { id: "oc4", name: "Aluguel", category: "Aluguel", type: "fixed", monthlyValue: 4000, active: true },
  { id: "oc5", name: "Embalagem", category: "Embalagem", type: "variable", monthlyValue: 1200, active: true },
]

// Vendas 30 dias por variante (mockado para módulo de metas)
export const MOCK_SALES_30D: Record<string, number> = {
  v1: 15,
  v2: 90,
  v3: 75,
  v4: 5,
  v5: 45,
  v6: 40,
}
