import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    if (!from || !to)
      return NextResponse.json({ error: "from e to são obrigatórios" }, { status: 400 })

    const { rows } = await pool.query(`
      SELECT
        e.id,
        'entrada'             AS tipo,
        e.insumo_id,
        i.nome                AS insumo_nome,
        COALESCE(i.grupo, i.nome) AS grupo,
        i.unidade,
        e.quantidade,
        e.custo_total,
        e.data,
        e.observacao,
        NULL::integer         AS impressora_id
      FROM dtf_insumo_entradas e
      JOIN dtf_insumos i ON i.id = e.insumo_id
      WHERE e.data BETWEEN $1 AND $2

      UNION ALL

      SELECT
        s.id,
        'saida'               AS tipo,
        s.insumo_id,
        i.nome                AS insumo_nome,
        COALESCE(i.grupo, i.nome) AS grupo,
        i.unidade,
        s.quantidade,
        NULL                  AS custo_total,
        s.data,
        s.observacao,
        s.impressora_id
      FROM dtf_insumo_saidas s
      JOIN dtf_insumos i ON i.id = s.insumo_id
      WHERE s.data BETWEEN $1 AND $2

      ORDER BY data DESC, tipo
    `, [from, to])

    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
