import { pool } from "@/lib/db"

export type TipoTecido = "aberto" | "tubular"

export type CreateBobinaForColorInput = {
  productId: string
  color: string
  // Ficha técnica pode vir incompleta — rascunho guarda o que foi digitado e
  // completa depois pelo Editar. Só quando os 6 campos vêm válidos o custo
  // é calculado de verdade; incompleto fica com total/preço zerados.
  tecido?: string | null
  tipoTecido?: TipoTecido | null
  pesoKg?: number | null
  gramatura?: number | null
  larguraM?: number | null
  precoKg?: number | null
}

export type CreateBobinaForColorResult = {
  entryId: number
  number: string
  totalQty: number
  unitPrice: number
  totalCost: number
}

// Cria a bobina de tecido de uma cor — usado pelo fluxo novo de Nova Ordem
// (Programação de Produção), onde a bobina nasce no clique da cor em vez de
// ser cadastrada antes em Insumos. Acha (ou cria) o par raw_materials/
// raw_material_variants correspondente ao produto+cor por trás dos panos, pra
// reaproveitar 100% do motor de custo que já existe (cost_per_piece,
// calculate_sku_costs) — só muda como a linha nasce.
export async function createBobinaForColor(
  input: CreateBobinaForColorInput
): Promise<CreateBobinaForColorResult> {
  const { productId, color, tecido, tipoTecido, pesoKg, gramatura, larguraM, precoKg } = input
  if (!productId || !color) throw new Error("productId e color são obrigatórios")

  const complete = !!(tecido && tipoTecido && pesoKg && gramatura && larguraM && precoKg)

  // Largura de corte real: tubular guarda a boca do tubo (medida fechada) —
  // a largura de corte é o dobro disso. Aberto usa a largura útil direto.
  let totalQty = 0, unitPrice = 0
  if (complete) {
    const larguraCorte = tipoTecido === "tubular" ? larguraM! * 2 : larguraM!
    totalQty = (pesoKg! * 1000) / (gramatura! * larguraCorte)
    const totalCost = pesoKg! * precoKg!
    unitPrice = totalCost / totalQty
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows: prodRows } = await client.query(`SELECT name FROM products WHERE id = $1`, [productId])
    if (!prodRows.length) throw new Error("Produto não encontrado")
    const productName = prodRows[0].name as string

    let materialId: number
    const { rows: matRows } = await client.query(
      `SELECT id FROM raw_materials WHERE product_id = $1`, [productId]
    )
    if (matRows.length) {
      materialId = matRows[0].id
    } else {
      const { rows: newMat } = await client.query(
        `INSERT INTO raw_materials (name, unit, product_id) VALUES ($1, 'm', $2) RETURNING id`,
        [productName, productId]
      )
      materialId = newMat[0].id
    }

    let variantId: number
    const { rows: varRows } = await client.query(
      `SELECT id FROM raw_material_variants WHERE material_id = $1 AND name = $2`, [materialId, color]
    )
    if (varRows.length) {
      variantId = varRows[0].id
    } else {
      const { rows: newVar } = await client.query(
        `INSERT INTO raw_material_variants (material_id, name) VALUES ($1, $2) RETURNING id`,
        [materialId, color]
      )
      variantId = newVar[0].id
    }

    const { rows } = await client.query(`
      INSERT INTO raw_material_entries
        (material_id, variant_id, number, total_qty, unit_price, status,
         tecido, tipo_tecido, peso_kg, gramatura, largura_m, preco_kg)
      VALUES ($1, $2, 'LOT-TEMP', $3, $4, 'usada', $5, $6, $7, $8, $9, $10)
      RETURNING id, total_cost AS "totalCost"
    `, [materialId, variantId, totalQty, unitPrice, tecido, tipoTecido, pesoKg, gramatura, larguraM, precoKg])

    const { id, totalCost: dbTotalCost } = rows[0]
    const number = `LOT-${String(id).padStart(4, "0")}`
    await client.query("UPDATE raw_material_entries SET number=$1 WHERE id=$2", [number, id])

    await client.query("COMMIT")

    return { entryId: id, number, totalQty, unitPrice, totalCost: Number(dbTotalCost) }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
