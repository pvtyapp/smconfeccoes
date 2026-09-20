import { pool } from "@/lib/db"

// Gate de auto-cadastro (decisão do replano v2 — "fechar a cartela de clientes
// fixos"): só libera Criar Conta na hora pra quem já tem pedido concluído.
// Quem não tem vira solicitação pendente em fornecedor_solicitacoes.
export async function hasConcludedOrderHistory(contactId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM orders WHERE contact_id = $1 AND status = 'concluido' LIMIT 1`,
    [contactId]
  )
  return rows.length > 0
}
