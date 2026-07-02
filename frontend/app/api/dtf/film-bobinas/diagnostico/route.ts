import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows: insumos } = await pool.query(`
      SELECT id, nome, unidade, grupo FROM dtf_insumos WHERE LOWER(grupo) = 'film' OR LOWER(unidade) = 'metro' ORDER BY id
    `)

    const { rows: entradas } = await pool.query(`
      SELECT e.id, e.insumo_id, i.nome, i.unidade, e.quantidade, e.custo_total, e.data, e.observacao
      FROM dtf_insumo_entradas e
      JOIN dtf_insumos i ON i.id = e.insumo_id
      WHERE LOWER(i.grupo) = 'film' OR LOWER(i.unidade) = 'metro'
      ORDER BY e.data
    `)

    const { rows: saidas } = await pool.query(`
      SELECT s.id, s.insumo_id, i.nome, i.unidade, s.quantidade, s.data, s.observacao, s.impressora_id
      FROM dtf_insumo_saidas s
      JOIN dtf_insumos i ON i.id = s.insumo_id
      WHERE LOWER(i.grupo) = 'film' OR LOWER(i.unidade) = 'metro'
      ORDER BY s.data
    `)

    const { rows: bobinas } = await pool.query(`
      SELECT id, impressora_id, tamanho_m, aberta_em, fechada_em, metros_usados, insumo_saida_id
      FROM dtf_film_bobinas ORDER BY aberta_em
    `)

    const { rows: saldo } = await pool.query(`
      SELECT
        i.id, i.nome, i.unidade,
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = i.id), 0) AS total_entradas,
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = i.id), 0) AS total_saidas
      FROM dtf_insumos i
      WHERE LOWER(i.grupo) = 'film' OR LOWER(i.unidade) = 'metro'
    `)

    return NextResponse.json({ insumos, entradas, saidas, bobinas, saldo })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
