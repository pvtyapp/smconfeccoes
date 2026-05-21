import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const VALID_STATUSES = ["triagem", "confirmando", "em_separacao", "pronto", "concluido", "cancelado"]

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const { status, actor, note } = await req.json()

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Status inválido. Use: ${VALID_STATUSES.join(", ")}` }, { status: 400 })
    }

    await client.query("BEGIN")
    await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id])
    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, $2, $3, $4)
    `, [id, status, actor ?? "dashboard", note ?? null])
    await client.query("COMMIT")

    return NextResponse.json({ success: true, status })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
