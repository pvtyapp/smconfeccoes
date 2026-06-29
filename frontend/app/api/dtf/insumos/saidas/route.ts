import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { insumoId, quantidade, data, observacao, impressoraId } = await req.json()
    if (!insumoId || !quantidade || !data)
      return NextResponse.json({ error: "insumoId, quantidade e data são obrigatórios" }, { status: 400 })

    await client.query("BEGIN")

    const { rows: saldoRows } = await client.query(`
      SELECT
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = $1), 0) -
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = $1), 0)
        AS saldo
    `, [insumoId])

    const saldo = Number(saldoRows[0].saldo)

    if (quantidade > saldo) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: `Saldo insuficiente. Disponível: ${parseFloat(saldo.toFixed(3))}` },
        { status: 422 }
      )
    }

    const { rows } = await client.query(`
      INSERT INTO dtf_insumo_saidas (insumo_id, quantidade, data, observacao, impressora_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [insumoId, quantidade, data, observacao ?? null, impressoraId ?? null])

    await client.query("COMMIT")
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
