import { pool } from "@/lib/db"

// Preenche a quantidade planejada por tamanho de uma cor já existente na ordem —
// usado pelo bot administrativo do WhatsApp na etapa de "quantidade" da criação
// guiada de ordem de produção.
export async function updateProdOrderGrade(
  orderId: number,
  color: string,
  qtyBySize: Record<string, number>
): Promise<void> {
  const { rows: existing } = await pool.query(
    `SELECT id, size FROM prod_order_items WHERE order_id = $1 AND color = $2`,
    [orderId, color]
  )
  if (!existing.length) throw new Error(`Cor "${color}" não encontrada na ordem ${orderId}`)

  for (const item of existing) {
    const qty = qtyBySize[item.size]
    if (qty === undefined) continue
    await pool.query(
      `UPDATE prod_order_items SET qty_planned = $1 WHERE id = $2`,
      [qty, item.id]
    )
  }
}
