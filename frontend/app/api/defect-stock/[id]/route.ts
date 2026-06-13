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
    const { disposition, notes, discountPrice } = await req.json()

    const valid = ["pendente", "reaproveitado", "vendido", "descartado"]
    if (disposition && !valid.includes(disposition)) {
      return NextResponse.json({ error: "disposition inválida" }, { status: 400 })
    }

    // If vendido and discountPrice provided, create a stock_movement OUT to record the sale
    const { rows: cur } = await pool.query(
      `SELECT variant_id, qty FROM defect_stock WHERE id=$1`, [id]
    )
    if (!cur.length) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      if (disposition === "vendido" && cur[0].variant_id) {
        await client.query(`
          INSERT INTO stock_movements
            (variant_id, type, quantity, reason, channel, notes)
          VALUES ($1, 'out', $2, 'venda_manual', 'avaria', $3)
        `, [cur[0].variant_id, cur[0].qty, notes ?? "Venda de peça com avaria"])
      }

      const { rows } = await client.query(`
        UPDATE defect_stock
        SET
          disposition   = COALESCE($1, disposition),
          notes         = COALESCE($2, notes)
        WHERE id = $3
        RETURNING id, disposition, notes
      `, [disposition ?? null, notes ?? null, id])

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
