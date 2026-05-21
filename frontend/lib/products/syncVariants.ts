import type { PoolClient } from "pg"

export async function syncVariants(
  client: PoolClient,
  productId: string,
  colors: string[],
  sizes: string[],
  salePrice: number,
  stockEnabled: boolean,
): Promise<void> {
  if (!stockEnabled) {
    await client.query(
      `UPDATE product_variants SET status = 'inactive' WHERE product_id = $1`,
      [productId],
    )
    return
  }

  const combos: { color: string; size: string }[] = []
  const c = colors.filter(Boolean)
  const s = sizes.filter(Boolean)

  if (c.length === 0 && s.length === 0) return

  if (c.length === 0) s.forEach((size) => combos.push({ color: "", size }))
  else if (s.length === 0) c.forEach((color) => combos.push({ color, size: "" }))
  else c.forEach((color) => s.forEach((size) => combos.push({ color, size })))

  const { rows: existing } = await client.query<{ id: string; color: string; size: string }>(
    `SELECT id, color, size FROM product_variants WHERE product_id = $1`,
    [productId],
  )

  const existingMap = new Map(existing.map((r) => [`${r.color}||${r.size}`, r.id]))
  const newKeys = new Set(combos.map((c) => `${c.color}||${c.size}`))

  for (const combo of combos) {
    const key = `${combo.color}||${combo.size}`
    if (existingMap.has(key)) {
      await client.query(
        `UPDATE product_variants SET status = 'active', sale_price = $1 WHERE id = $2`,
        [salePrice, existingMap.get(key)],
      )
    } else {
      await client.query(
        `INSERT INTO product_variants (product_id, color, size, sale_price, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [productId, combo.color, combo.size, salePrice],
      )
    }
  }

  for (const [key, id] of existingMap) {
    if (!newKeys.has(key)) {
      await client.query(
        `UPDATE product_variants SET status = 'inactive' WHERE id = $1`,
        [id],
      )
    }
  }
}
