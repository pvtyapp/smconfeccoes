import { pool } from "@/lib/db"

export type CreateProdOrderInput = {
  productId: string
  selectedColors: string[]
  entries: { entryId: number; color?: string }[]
}

export type CreateProdOrderResult = {
  id: number
  number: string
  createdAt: string
}

// Cria uma ordem de produção (grade zerada + materiais vinculados) — usado tanto
// pela tela de Programação de Produção quanto pelo bot administrativo do WhatsApp,
// pra garantir que os dois caminhos criem exatamente a mesma coisa.
export async function createProdOrder(input: CreateProdOrderInput): Promise<CreateProdOrderResult> {
  const { productId, selectedColors, entries } = input
  if (!productId || !selectedColors?.length) {
    throw new Error("productId e selectedColors são obrigatórios")
  }

  const { rows: prods } = await pool.query(
    `SELECT name, COALESCE(size_list,'{}') AS sizes FROM products WHERE id=$1`,
    [productId]
  )
  if (!prods.length) throw new Error("Produto não encontrado")
  const { name: productName, sizes } = prods[0]

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    for (const entry of entries) {
      const { rows: entryRows } = await client.query(
        `SELECT status FROM raw_material_entries WHERE id = $1`,
        [entry.entryId]
      )
      if (!entryRows.length) throw new Error(`Lote ${entry.entryId} não encontrado`)
      if (entryRows[0].status === "esgotada") throw new Error(`Lote ${entry.entryId} já está esgotado e não pode ser usado`)
    }

    const { rows } = await client.query(`
      INSERT INTO prod_orders (product_id, product_name, number, status)
      VALUES ($1, $2, 'OP-TEMP', 'em_andamento')
      RETURNING id, created_at AS "createdAt"
    `, [productId, productName])

    const { id, createdAt } = rows[0]
    const number = `OP-${String(id).padStart(4, "0")}`
    await client.query("UPDATE prod_orders SET number=$1 WHERE id=$2", [number, id])

    for (const color of selectedColors) {
      for (const size of sizes) {
        await client.query(`
          INSERT INTO prod_order_items (order_id, product_name, color, size, qty_planned)
          VALUES ($1, $2, $3, $4, 0)
        `, [id, productName, color, size])
      }
    }

    for (const entry of entries) {
      await client.query(
        `INSERT INTO prod_order_materials (order_id, entry_id, color) VALUES ($1, $2, $3)`,
        [id, entry.entryId, entry.color ?? null]
      ).catch(() =>
        client.query(
          `INSERT INTO prod_order_materials (order_id, entry_id) VALUES ($1, $2)`,
          [id, entry.entryId]
        )
      )
    }

    await client.query("COMMIT")

    pool.query(
      `INSERT INTO prod_order_logs (order_id, event, payload) VALUES ($1, $2, $3)`,
      [id, "criada", JSON.stringify({ productId, productName, selectedColors, entryCount: entries.length })]
    ).catch(() => {})

    return { id, number, createdAt }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
