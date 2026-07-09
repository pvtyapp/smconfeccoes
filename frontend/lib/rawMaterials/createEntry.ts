import { pool } from "@/lib/db"

export type CreateEntryResult = {
  id: number
  number: string
  materialId: number
  materialName: string
  unit: string
  variantId: number | null
  varianteName: string | null
  totalQty: number
  unitPrice: number
  totalCost: number
  status: string
  createdAt: string
}

// Dá entrada de um lote novo num material (+ variação opcional) já cadastrado —
// usado tanto pela tela de Matéria Prima quanto pelo bot administrativo do
// WhatsApp, pra garantir que os dois caminhos criem exatamente a mesma coisa.
export async function createRawMaterialEntry(
  materialId: number, variantId: number | null, qty: number, price: number
): Promise<CreateEntryResult> {
  if (!materialId || !qty) throw new Error("materialId e qty são obrigatórios")

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows } = await client.query(`
      INSERT INTO raw_material_entries
        (material_id, variant_id, number, total_qty, unit_price, status)
      VALUES ($1, $2, 'LOT-TEMP', $3, $4, 'disponivel')
      RETURNING id
    `, [materialId, variantId, qty, price ?? 0])

    const { id } = rows[0]
    const number = `LOT-${String(id).padStart(4, "0")}`
    await client.query("UPDATE raw_material_entries SET number=$1 WHERE id=$2", [number, id])

    await client.query("COMMIT")

    const { rows: full } = await pool.query(`
      SELECT
        rme.id, rme.number,
        rme.material_id AS "materialId", rm.name AS "materialName", rm.unit,
        rme.variant_id AS "variantId", rmv.name AS "varianteName",
        rme.total_qty AS "totalQty", rme.unit_price AS "unitPrice",
        rme.total_cost AS "totalCost", rme.status,
        rme.created_at::date::text AS "createdAt"
      FROM raw_material_entries rme
      JOIN raw_materials rm ON rm.id = rme.material_id
      LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
      WHERE rme.id = $1
    `, [id])

    return full[0]
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
