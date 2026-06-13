// ─── Tipos e mock compartilhados para BOM (Receita de Produção) ───────────────
// Importado por: produtos/page.tsx, programacao/page.tsx, custo-producao/page.tsx

export type ColorMatch = "same" | "any"

export type BomItem = {
  materialId:      number
  materialName:    string
  unit:            "kg" | "m" | "unidade"
  qtyPerPieceBase: number   // quantidade por peça no tamanho M (base)
  colorMatch:      ColorMatch
  variantOverride?: string  // quando colorMatch="any", qual variante usar
}

// Pesos globais por tamanho — multiplicador em relação ao M (base = 1.00)
export const DEFAULT_SIZE_WEIGHTS: Record<string, number> = {
  PP:   0.75,
  P:    0.85,
  M:    1.00,
  G:    1.15,
  GG:   1.30,
  XGG:  1.45,
  XXXL: 1.60,
}

// Preços unitários dos insumos (mock — em produção virá de raw_materials)
export const MOCK_MATERIAL_PRICES: { materialName: string; unitPrice: number }[] = [
  { materialName: "Moletom 80% Algodão", unitPrice: 22   },
  { materialName: "Ribana",              unitPrice: 18   },
  { materialName: "Cadarço",             unitPrice:  0.8 },
]

// BOM keyed pelo nome do produto (productName)
// Em produção: virá de product_bom via API
export const MOCK_BOM: Record<string, BomItem[]> = {
  "Moletom Canguru": [
    {
      materialId: 1, materialName: "Moletom 80% Algodão", unit: "kg",
      qtyPerPieceBase: 0.30, colorMatch: "same",
    },
    {
      materialId: 2, materialName: "Ribana", unit: "kg",
      qtyPerPieceBase: 0.05, colorMatch: "any", variantOverride: "Branca",
    },
    {
      materialId: 3, materialName: "Cadarço", unit: "unidade",
      qtyPerPieceBase: 1, colorMatch: "any", variantOverride: "Preto",
    },
  ],
  "Camiseta Básica": [
    {
      materialId: 1, materialName: "Moletom 80% Algodão", unit: "kg",
      qtyPerPieceBase: 0.18, colorMatch: "same",
    },
  ],
  "Calça de Moletom": [
    {
      materialId: 1, materialName: "Moletom 80% Algodão", unit: "kg",
      qtyPerPieceBase: 0.45, colorMatch: "same",
    },
    {
      materialId: 2, materialName: "Ribana", unit: "kg",
      qtyPerPieceBase: 0.04, colorMatch: "any", variantOverride: "Branca",
    },
  ],
}

// Peso de um tamanho: usa override por produto se existir, senão global
export function getSizeWeight(
  size: string,
  productOverrides?: Record<string, number>
): number {
  return productOverrides?.[size] ?? DEFAULT_SIZE_WEIGHTS[size] ?? 1.0
}

// Calcula custo de material por peça no tamanho M, dado o preço unitário de cada material
// materials: { materialName, unitPrice (R$/kg or R$/und) }[]
export function calcSkuCosts(
  productName: string,
  grade: { color: string; size: string; qtyProduced: number }[],
  materialPrices: { materialName: string; unitPrice: number }[],
  productWeightOverrides?: Record<string, number>
): {
  color: string; size: string; qty: number
  weight: number; costMaterial: number
}[] {
  const bom = MOCK_BOM[productName]
  if (!bom || bom.length === 0) return []

  const priceMap = Object.fromEntries(materialPrices.map(m => [m.materialName, m.unitPrice]))

  // Custo de material por peça M (soma de todos os insumos do BOM)
  const costPerPieceM = bom.reduce((sum, item) => {
    const price = priceMap[item.materialName] ?? 0
    return sum + item.qtyPerPieceBase * price
  }, 0)

  return grade
    .filter(r => r.qtyProduced > 0)
    .map(r => {
      const weight = getSizeWeight(r.size, productWeightOverrides)
      return {
        color: r.color,
        size:  r.size,
        qty:   r.qtyProduced,
        weight,
        costMaterial: costPerPieceM * weight,
      }
    })
}
