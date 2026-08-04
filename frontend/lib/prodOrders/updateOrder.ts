import { pool } from "@/lib/db"

export type UpdateProdOrderInput = {
  selectedColors: string[]
  entries: { entryId: number; color?: string }[]
  grade: { color: string; size: string; qtyPlanned: number }[]
}

// Completa uma ordem em rascunho (ou ajusta uma em andamento): cores novas
// ganham grade zerada pro produto inteiro, bobinas novas se vinculam, e as
// quantidades planejadas do grade[] são aplicadas por cima. Só mexe em ordem
// que ainda está em_andamento — depois de concluída os dados viram histórico.
export async function updateProdOrder(orderId: number, input: UpdateProdOrderInput): Promise<void> {
  const { selectedColors, entries, grade } = input
  if (!selectedColors?.length) throw new Error("selectedColors é obrigatório")

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows: orderRows } = await client.query(
      `SELECT product_id AS "productId", product_name AS "productName", status FROM prod_orders WHERE id=$1 FOR UPDATE`,
      [orderId]
    )
    if (!orderRows.length) throw new Error("Ordem não encontrada")
    const { productId, productName, status } = orderRows[0]
    if (status !== "em_andamento") throw new Error("Só dá pra editar ordem em andamento")

    const { rows: prodRows } = await client.query(
      `SELECT COALESCE(size_list,'{}') AS sizes FROM products WHERE id=$1`, [productId]
    )
    const sizes: string[] = prodRows[0]?.sizes ?? []

    const { rows: existingItems } = await client.query(
      `SELECT DISTINCT color FROM prod_order_items WHERE order_id=$1`, [orderId]
    )
    const existingColors = new Set(existingItems.map(r => r.color as string))

    for (const color of selectedColors) {
      if (existingColors.has(color)) continue
      for (const size of sizes) {
        await client.query(`
          INSERT INTO prod_order_items (order_id, product_name, color, size, qty_planned)
          VALUES ($1, $2, $3, $4, 0)
        `, [orderId, productName, color, size])
      }
    }

    for (const g of grade) {
      await client.query(`
        UPDATE prod_order_items SET qty_planned=$1
        WHERE order_id=$2 AND color=$3 AND size=$4
      `, [g.qtyPlanned, orderId, g.color, g.size])
    }

    const { rows: existingMats } = await client.query(
      `SELECT entry_id AS "entryId" FROM prod_order_materials WHERE order_id=$1`, [orderId]
    )
    const linkedEntryIds = new Set(existingMats.map(r => Number(r.entryId)))

    for (const entry of entries) {
      if (linkedEntryIds.has(entry.entryId)) continue
      const { rows: entryRows } = await client.query(
        `SELECT status FROM raw_material_entries WHERE id = $1`, [entry.entryId]
      )
      if (!entryRows.length) throw new Error(`Lote ${entry.entryId} não encontrado`)
      if (entryRows[0].status === "esgotada") throw new Error(`Lote ${entry.entryId} já está esgotado e não pode ser usado`)
      await client.query(
        `INSERT INTO prod_order_materials (order_id, entry_id, color) VALUES ($1, $2, $3)`,
        [orderId, entry.entryId, entry.color ?? null]
      )
    }

    await client.query("COMMIT")

    pool.query(
      `INSERT INTO prod_order_logs (order_id, event, payload) VALUES ($1, $2, $3)`,
      [orderId, "editada", JSON.stringify({ selectedColors, entryCount: entries.length })]
    ).catch(() => {})
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

// Remove um rascunho/ordem que ainda não foi concluída. Bobina criada só pra
// essa ordem some junto (senão vira lote fantasma com 0 peça pra sempre); se
// outra ordem também usa a mesma bobina, só desvincula e ela continua.
export async function deleteProdOrder(orderId: number): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows: orderRows } = await client.query(
      `SELECT status FROM prod_orders WHERE id=$1 FOR UPDATE`, [orderId]
    )
    if (!orderRows.length) throw new Error("Ordem não encontrada")
    if (orderRows[0].status !== "em_andamento") throw new Error("Só dá pra apagar ordem em andamento")

    const { rows: mats } = await client.query(
      `SELECT entry_id AS "entryId" FROM prod_order_materials WHERE order_id=$1`, [orderId]
    )

    await client.query(`DELETE FROM prod_orders WHERE id=$1`, [orderId])
    await client.query(`DELETE FROM prod_order_logs WHERE order_id=$1`, [orderId]).catch(() => {})

    for (const m of mats) {
      const { rows: stillLinked } = await client.query(
        `SELECT 1 FROM prod_order_materials WHERE entry_id=$1 LIMIT 1`, [m.entryId]
      )
      if (!stillLinked.length) {
        await client.query(`DELETE FROM raw_material_entries WHERE id=$1`, [m.entryId])
      }
    }

    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
