import { pool } from "@/lib/db"

// Preço do metro de DTF = sale_price do produto "DTF..." ativo mais antigo (fonte única).
// Usado pela tela (/api/dtf/preco) e pelo servidor, que calcula o valor do pedido quando
// quem conclui não pode ver preço (a tela não manda precoCobrado).
export async function precoMetroDtf(db: { query: typeof pool.query } = pool): Promise<{ precoMetro: number; productName: string } | null> {
  const { rows } = await db.query(`
    SELECT name, sale_price AS "precoMetro"
    FROM products
    WHERE LOWER(name) LIKE 'dtf%' AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
  `)
  return rows[0] ? { precoMetro: Number(rows[0].precoMetro), productName: rows[0].name } : null
}
