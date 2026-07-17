import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Backfill: order_items de vendas do PDV nunca gravavam variant_id (só
// existia no stock_movements) -- sem isso, cancelar uma venda de PDV nunca
// devolvia estoque, porque a rota de cancelamento só reverte item com
// variant_id preenchido (AND variant_id IS NOT NULL). Casa produto+cor+
// tamanho com o cadastro de variantes, mesmo padrão usado no financeiro.
export async function POST() {
  try {
    const { rows } = await pool.query(`
      UPDATE order_items oi
      SET variant_id = pv.id
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE oi.variant_id IS NULL
        AND TRIM(LOWER(p.name)) = TRIM(LOWER(oi.product_name))
        AND TRIM(LOWER(pv.color)) = TRIM(LOWER(COALESCE(oi.color, '')))
        AND TRIM(LOWER(pv.size)) = TRIM(LOWER(COALESCE(oi.size, '')))
      RETURNING oi.id
    `)
    return NextResponse.json({ ok: true, updated: rows.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
