import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows: todosInsumos } = await pool.query(`
      SELECT id, nome, unidade, grupo FROM dtf_insumos ORDER BY id
    `)

    const { rows: todasSaidas } = await pool.query(`
      SELECT s.id, s.insumo_id, i.nome AS insumo_nome, i.unidade, s.quantidade, s.data, s.observacao, s.impressora_id
      FROM dtf_insumo_saidas s
      JOIN dtf_insumos i ON i.id = s.insumo_id
      ORDER BY s.data, s.id
    `)

    const { rows: bobinas } = await pool.query(`
      SELECT id, impressora_id, tamanho_m, aberta_em::date AS aberta_em, fechada_em::date AS fechada_em,
             metros_usados, insumo_saida_id
      FROM dtf_film_bobinas ORDER BY aberta_em
    `)

    const { rows: saldos } = await pool.query(`
      SELECT
        i.id, i.nome, i.unidade, i.grupo,
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = i.id), 0)::float AS total_entradas,
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = i.id), 0)::float AS total_saidas
      FROM dtf_insumos i
      ORDER BY i.id
    `)

    return NextResponse.json({ todosInsumos, todasSaidas, bobinas, saldos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
