import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário, NÃO destrutivo: roda o mesmo UPDATE do PATCH /api/defect-stock/[id]
// dentro de uma transação e sempre dá ROLLBACK no final — só pra ver se a query
// quebra com algum erro real, sem alterar nenhum dado de verdade.
export async function GET() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows: cur } = await client.query(
      `SELECT variant_id, qty, disposition AS current_disposition FROM defect_stock WHERE id=9`
    )
    if (!cur.length) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "id 9 não encontrado" }, { status: 404 })
    }

    const disposition: string = "descartado"
    const notes = "teste debug — será desfeito"
    const wasActive  = cur[0].current_disposition === "pendente"
    const isResolved = disposition && disposition !== "pendente"

    const { rows } = await client.query(`
      UPDATE defect_stock
      SET
        disposition  = COALESCE($1, disposition),
        notes        = COALESCE($2, notes),
        sale_price   = CASE WHEN $5::numeric IS NOT NULL THEN $5::numeric ELSE sale_price END,
        resolved_at  = CASE WHEN $3 THEN NOW() ELSE resolved_at END
      WHERE id = $4
      RETURNING id, disposition, notes, sale_price AS "salePrice", resolved_at AS "resolvedAt"
    `, [disposition ?? null, notes ?? null, wasActive && isResolved, 9, null])

    await client.query("ROLLBACK")
    return NextResponse.json({ ok: true, wouldHaveUpdatedTo: rows[0], wasActive, isResolved, note: "rollback aplicado, nada foi salvo de verdade" })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
