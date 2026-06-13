import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { insumoId, quantidade, custoTotal, data, observacao } = await req.json()
    if (!insumoId || !quantidade || !data)
      return NextResponse.json({ error: "insumoId, quantidade e data são obrigatórios" }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO dtf_insumo_entradas (insumo_id, quantidade, custo_total, data, observacao)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [insumoId, quantidade, custoTotal ?? null, data, observacao ?? null])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
