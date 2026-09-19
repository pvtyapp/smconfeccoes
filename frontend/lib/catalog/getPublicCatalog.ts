import { pool } from "@/lib/db"

export type PublicCatalogVariant = { id: string; color: string | null; size: string | null; available: boolean }
export type PublicCatalogImage = { url: string; color: string | null }
export type PublicCatalogProduct = {
  id: string
  name: string
  description: string | null
  salePrice: number
  variants: PublicCatalogVariant[]
  images: PublicCatalogImage[]
}

// Catálogo público — fonte única (decisão 7 do plano): mesma consulta serve
// a vitrine da LP e o catálogo do cliente logado. Sem preço de custo, sem
// saldo exato — só "disponível/indisponível" (decisão 4).
export async function getPublicCatalog(): Promise<PublicCatalogProduct[]> {
  const { rows: variantRows } = await pool.query(`
    SELECT
      p.id           AS "productId",
      p.name,
      p.description,
      p.sale_price   AS "salePrice",
      pv.id          AS "variantId",
      pv.color,
      pv.size,
      (GREATEST(0, COALESCE(bal.qty, 0) - COALESCE(locked.locked_qty, 0)) > 0) AS available
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.status = 'active'
    LEFT JOIN (
      SELECT variant_id,
             SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
      FROM stock_movements
      GROUP BY variant_id
    ) bal ON bal.variant_id = pv.id
    LEFT JOIN (
      SELECT oi.variant_id, SUM(oi.qty) AS locked_qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ('triagem', 'em_separacao', 'pronto') AND oi.variant_id IS NOT NULL
      GROUP BY oi.variant_id
    ) locked ON locked.variant_id = pv.id
    WHERE p.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
      AND p.stock_enabled = true AND LOWER(p.name) NOT LIKE '%dtf%'
    ORDER BY p.name ASC, pv.color ASC, array_position(p.size_list, pv.size)
  `)

  const { rows: imageRows } = await pool.query(`
    SELECT product_id AS "productId", color, image_url AS "imageUrl", display_order AS "displayOrder"
    FROM product_images
    ORDER BY product_id, color NULLS FIRST, display_order ASC, created_at ASC
  `)

  const products = new Map<string, PublicCatalogProduct>()
  for (const r of variantRows) {
    if (!products.has(r.productId)) {
      products.set(r.productId, {
        id: r.productId, name: r.name, description: r.description, salePrice: Number(r.salePrice),
        variants: [], images: [],
      })
    }
    products.get(r.productId)!.variants.push({ id: r.variantId, color: r.color, size: r.size, available: r.available })
  }
  for (const r of imageRows) {
    products.get(r.productId)?.images.push({ url: r.imageUrl, color: r.color })
  }

  return [...products.values()]
}
