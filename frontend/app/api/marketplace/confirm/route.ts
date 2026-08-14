import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

type ConfirmRow = { variantId: string; qty: number }

// Confirma a separação: grava o registro (marketplace_separations + items) e
// desconta do estoque de verdade via stock_movements — mesma tabela que
// produção/Kanban usam, só com reason/channel próprios pra não se misturar
// com vendas no Mapa da Operação e nos relatórios (ver GET /api/producao/mapa).
//
// Só chega aqui pelo "Montar na mão" — cada linha já é uma escolha manual
// de produto/cor/tamanho, sem casamento automático nem kit expandido.
export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { origin, rows } = await req.json() as { origin?: string; rows?: ConfirmRow[] }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Nenhum item pra confirmar" }, { status: 400 })
    }
    if (rows.some(r => !r.variantId || !r.qty || r.qty <= 0)) {
      return NextResponse.json({ error: "Item com variante ou quantidade inválida" }, { status: 400 })
    }

    await client.query("BEGIN")

    const numRes = await client.query(
      `SELECT 'MKT-' || LPAD(nextval('marketplace_separation_seq')::text, 4, '0') AS num`
    )
    const number = numRes.rows[0].num as string
    const totalItems = rows.length
    const totalPieces = rows.reduce((s, r) => s + r.qty, 0)

    const sepRes = await client.query(`
      INSERT INTO marketplace_separations (number, origin, total_items, total_pieces)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [number, origin ?? "manual", totalItems, totalPieces])
    const separationId = sepRes.rows[0].id

    for (const r of rows) {
      await client.query(`
        INSERT INTO marketplace_separation_items (separation_id, variant_id, qty, source)
        VALUES ($1, $2, $3, 'manual')
      `, [separationId, r.variantId, r.qty])

      await client.query(`
        INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
        VALUES ($1, 'out', $2, 'marketplace_separacao', 'marketplace', $3)
      `, [r.variantId, r.qty, `Separação ${number}`])
    }

    await client.query("COMMIT")

    const { rows: itemsDetail } = await pool.query(`
      SELECT p.name AS "productName", pv.color, pv.size, pv.sku, msi.qty
      FROM marketplace_separation_items msi
      JOIN product_variants pv ON pv.id = msi.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE msi.separation_id = $1
      ORDER BY p.name, pv.color, pv.size
    `, [separationId])

    return NextResponse.json({ number, totalItems, totalPieces, items: itemsDetail })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/marketplace/confirm:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
