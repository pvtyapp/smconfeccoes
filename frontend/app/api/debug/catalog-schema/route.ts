import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: inspeciona schema/constraints/dados reais de catalog_products
// pra investigar erro ao subir produto novo na aba "Produtos na LP".
export async function GET() {
  try {
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'catalog_products' ORDER BY ordinal_position
    `)
    const { rows: imgCols } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'catalog_product_images' ORDER BY ordinal_position
    `)
    const { rows: constraints } = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'catalog_products'::regclass OR conrelid = 'catalog_product_images'::regclass
    `)
    const { rows: products } = await pool.query(`
      SELECT id, name, image_url, display_order, active, created_at FROM catalog_products ORDER BY id
    `).catch(e => ({ rows: [{ error: String(e) }] }))

    return NextResponse.json({ ok: true, columns: cols, imageColumns: imgCols, constraints, products })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
