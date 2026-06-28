import { pool } from "@/lib/db"
import type { ParsedItem } from "@/lib/ai/parseOrder"

export type MatchedItem = ParsedItem & {
  variantId: string | null
  unitPrice: number | null
  sku: string | null
  matched: boolean
  alternatives: string[]
  currentStock: number
  stockOk: boolean
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
  const wa = na.split(/\s+/).filter(Boolean)
  const wb = nb.split(/\s+/).filter(Boolean)
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (shorter.length > 0 && shorter.every(w => longer.includes(w))) return 0.85
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
  currentStock: number
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
      pv.sale_price   AS "salePrice",
      GREATEST(
        COALESCE(bal.qty, 0) - COALESCE(rsvd.qty_notified, 0),
        0
      )::int AS "currentStock"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN (
      SELECT variant_id,
             SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
      FROM stock_movements
      GROUP BY variant_id
    ) bal ON bal.variant_id = pv.id
    LEFT JOIN (
      SELECT variant_id, SUM(qty) AS qty_notified
      FROM product_reservations
      WHERE status = 'notified'
      GROUP BY variant_id
    ) rsvd ON rsvd.variant_id = pv.id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
  `)

  return items.map(item => {
    let best: Variant | null = null
    let bestScore = 0

    for (const v of variants) {
      const nameScore  = score(item.productName, v.productName)
      const colorScore = item.color ? score(item.color, v.color) : 0.5
      const sizeScore  = item.size  ? score(item.size,  v.size)  : 0.5

      if (item.color && colorScore < 0.35) continue

      const total = nameScore * 0.5 + colorScore * 0.25 + sizeScore * 0.25

      if (total > bestScore && total > 0.5) {
        bestScore = total
        best = v
      }
    }

    const alternatives = best
      ? []
      : variants
          .filter(v => score(item.productName, v.productName) > 0.5)
          .map(v => [v.color, v.size].filter(Boolean).join(" "))
          .filter(Boolean)
          .slice(0, 5)

    const currentStock = best?.currentStock ?? 0
    return {
      ...item,
      variantId:    best?.id ?? null,
      unitPrice:    best ? Number(best.salePrice) : null,
      sku:          best?.sku ?? null,
      matched:      best !== null,
      alternatives: [...new Set(alternatives)],
      currentStock,
      stockOk:      best !== null && currentStock >= item.qty,
    }
  })
}
