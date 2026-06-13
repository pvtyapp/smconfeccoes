import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { alarmeQtd } = await req.json()
    await pool.query(
      `UPDATE dtf_insumos SET alarme_qtd = $1 WHERE id = $2`,
      [alarmeQtd ?? null, id]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    await client.query("BEGIN")
    await client.query(`DELETE FROM dtf_insumo_saidas   WHERE insumo_id = $1`, [id])
    await client.query(`DELETE FROM dtf_insumo_entradas WHERE insumo_id = $1`, [id])
    await client.query(`DELETE FROM dtf_insumos         WHERE id = $1`,        [id])
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
