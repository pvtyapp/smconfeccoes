import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PATCH: update disposition + optional notes
// disposition: pendente | reaproveitado | vendido | descartado
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { disposition, notes, salePrice } = await req.json()

    const valid = ["pendente", "reaproveitado", "vendido", "descartado"]
    if (disposition && !valid.includes(disposition)) {
      return NextResponse.json({ error: "disposition inválida" }, { status: 400 })
    }

    const { rows: cur } = await pool.query(
      `SELECT variant_id, qty, disposition AS current_disposition FROM defect_stock WHERE id=$1`, [id]
    )
    if (!cur.length) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Ensure columns exist (safe idempotent migrations)
    await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE defect_stock ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10,2)`).catch(() => {})

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const wasActive  = cur[0].current_disposition === "pendente"
      const isResolved = disposition && disposition !== "pendente"

      // vendido → saída do estoque normal
      if (disposition === "vendido" && cur[0].variant_id && wasActive) {
        await client.query(`
          INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
          VALUES ($1, 'out', $2, 'venda_manual', 'avaria', $3)
        `, [cur[0].variant_id, cur[0].qty, notes ?? "Venda de peça com avaria"])
      }

      // reaproveitado → peça consertada volta pro estoque normal
      if (disposition === "reaproveitado" && cur[0].variant_id && wasActive) {
        await client.query(`
          INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
          VALUES ($1, 'in', $2, 'reaproveitamento_avaria', 'avaria', $3)
        `, [cur[0].variant_id, cur[0].qty, notes ?? "Peça com avaria reaproveitada"])
      }

      const { rows } = await client.query(`
        UPDATE defect_stock
        SET
          disposition  = COALESCE($1, disposition),
          notes        = COALESCE($2, notes),
          sale_price   = CASE WHEN $5 IS NOT NULL THEN $5 ELSE sale_price END,
          resolved_at  = CASE WHEN $3 THEN NOW() ELSE resolved_at END
        WHERE id = $4
        RETURNING id, disposition, notes, sale_price AS "salePrice", resolved_at AS "resolvedAt"
      `, [disposition ?? null, notes ?? null, wasActive && isResolved, id, salePrice ?? null])

      await client.query("COMMIT")
      return NextResponse.json(rows[0])
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
