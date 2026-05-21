import { pool } from "@/lib/db"
import type { ParsedItem } from "@/lib/ai/parseOrder"

export type MatchedItem = ParsedItem & {
  variantId: string | null
  unitPrice: number | null
  sku: string | null
  matched: boolean
}

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim()
}

function score(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  const wa = na.split(/\s+/)
  const wb = nb.split(/\s+/)
  const hits = wa.filter(w => w.length > 2 && wb.includes(w)).length
  return hits / Math.max(wa.length, wb.length)
}

type Variant = {
  id: string
  productId: string
  productName: string
  color: string
  size: string
  sku: string
  salePrice: number
}

export async function matchVariants(items: ParsedItem[]): Promise<MatchedItem[]> {
  const { rows: variants } = await pool.query<Variant>(`
    SELECT
      pv.id,
      pv.product_id   AS "productId",
      p.name          AS "productName",
      pv.color,
      pv.size,
      pv.sku,
      pv.sale_price   AS "salePrice"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true
  `)

  return items.map(item => {
    let best: Variant | null = null
    let bestScore = 0

    for (const v of variants) {
      const nameScore  = score(item.productName, v.productName)
      const colorScore = item.color ? score(item.color, v.color) : 0.5
      const sizeScore  = item.size  ? score(item.size,  v.size)  : 0.5
      const total      = nameScore * 0.6 + colorScore * 0.25 + sizeScore * 0.15

      if (total > bestScore && total > 0.5) {
        bestScore = total
        best = v
      }
    }

    return {
      ...item,
      variantId: best?.id ?? null,
      unitPrice: best ? Number(best.salePrice) : null,
      sku:       best?.sku ?? null,
      matched:   best !== null,
    }
  })
}
