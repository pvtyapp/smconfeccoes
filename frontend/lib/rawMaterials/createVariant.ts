import { pool } from "@/lib/db"

export type CreateVariantResult = {
  id: number
  raizId: number
  name: string
  autoDestock: boolean
  minQty: number | null
}

// Cria uma variação (cor) nova dentro de um material já cadastrado — usado tanto
// pela tela de Matéria Prima quanto pelo bot administrativo do WhatsApp.
export async function createRawMaterialVariant(
  materialId: number, name: string, autoDestock = false, minQty: number | null = null
): Promise<CreateVariantResult> {
  if (!materialId || !name?.trim()) throw new Error("materialId e name são obrigatórios")

  const { rows } = await pool.query(`
    INSERT INTO raw_material_variants (material_id, name, auto_destock, min_qty)
    VALUES ($1, $2, $3, $4)
    RETURNING id, material_id AS "raizId", name, auto_destock AS "autoDestock", min_qty AS "minQty"
  `, [materialId, name.trim(), autoDestock, minQty])

  return rows[0]
}
