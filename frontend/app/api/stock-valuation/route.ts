import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { exigirFinanceiro } from "@/lib/acesso"

// GET /api/stock-valuation
// Snapshot de capital em estoque — independente de período
export async function GET() {
  const semPermissao = await exigirFinanceiro()
  if (semPermissao) return semPermissao

  try {
    // Produtos: agrupado por produto (soma todas as variações)
    const { rows: products } = await pool.query(`
      SELECT
        p.name                                                                              AS "productName",
        COALESCE(SUM(GREATEST(COALESCE(bal.qty, 0), 0)), 0)::int                           AS qty,
        COALESCE(p.material_cost, 0)::float                                                 AS "costPrice",
        COALESCE(p.sale_price, 0)::float                                                    AS "salePrice"
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id AND pv.status = 'active'
      LEFT JOIN (
        SELECT variant_id,
               SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
        FROM stock_movements
        GROUP BY variant_id
      ) bal ON bal.variant_id = pv.id
      WHERE p.status = 'active'
      GROUP BY p.id, p.name, p.material_cost, p.sale_price
      HAVING COALESCE(SUM(GREATEST(COALESCE(bal.qty, 0), 0)), 0) > 0
      ORDER BY p.name ASC
    `)

    // Matéria-prima da Produção saiu do painel (PIV 05/11): o valor do estoque é só
    // das peças, ao "Custo" de Produtos. Mantém o formato da resposta.
    const rawMaterials: { totalCost: number }[] = []

    const productItems = products.map(r => ({
      ...r,
      totalCost: r.qty * r.costPrice,
      totalSale: r.qty * r.salePrice,
    }))

    const productTotalCost = productItems.reduce((s, r) => s + r.totalCost, 0)
    const productTotalSale = productItems.reduce((s, r) => s + r.totalSale, 0)
    const rawTotalCost     = rawMaterials.reduce((s, r) => s + r.totalCost, 0)

    return NextResponse.json({
      products: {
        items:     productItems,
        totalCost: productTotalCost,
        totalSale: productTotalSale,
      },
      rawMaterials: {
        items:     rawMaterials,
        totalCost: rawTotalCost,
      },
      grandTotalCost: productTotalCost + rawTotalCost,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
