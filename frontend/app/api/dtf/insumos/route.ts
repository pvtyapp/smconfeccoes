import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { nome, unidade, grupo } = await req.json()
    if (!nome?.trim() || !unidade?.trim())
      return NextResponse.json({ error: "nome e unidade são obrigatórios" }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO dtf_insumos (nome, unidade, grupo)
      VALUES ($1, $2, $3)
      RETURNING id, nome, unidade, grupo
    `, [nome.trim(), unidade.trim(), (grupo ?? nome).trim()])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const { rows: insumos } = await pool.query(`
      SELECT id, nome, unidade, alarme_qtd, COALESCE(grupo, nome) AS grupo
      FROM dtf_insumos ORDER BY grupo, nome, id
    `)

    const { rows: metrosRows } = await pool.query(`
      SELECT
        COALESCE(SUM(metros), 0)                                                        AS total_metros,
        COALESCE(SUM(CASE WHEN data >= CURRENT_DATE - 89 THEN metros ELSE 0 END), 0)   AS metros_90d
      FROM dtf_pedidos
    `)
    const totalMetros  = Number(metrosRows[0].total_metros)
    const metros90d    = Number(metrosRows[0].metros_90d)
    const metrosPorDia = metros90d / 90

    const result = await Promise.all(insumos.map(async (ins) => {
      const { rows: aggRows } = await pool.query(`
        SELECT
          COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = $1), 0) AS total_entradas,
          COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = $1), 0) AS total_saidas
      `, [ins.id])

      const totalEntradas = Number(aggRows[0].total_entradas)
      const totalSaidas   = Number(aggRows[0].total_saidas)
      const saldoAtual    = totalEntradas - totalSaidas

      const consumoMedioPorMetro = totalMetros > 0 && totalSaidas > 0
        ? totalSaidas / totalMetros : null

      const consumoDiario = consumoMedioPorMetro && metrosPorDia > 0
        ? consumoMedioPorMetro * metrosPorDia : null

      const diasRestantes = consumoDiario && consumoDiario > 0
        ? Math.round(saldoAtual / consumoDiario) : null

      const alarmeQtd = ins.alarme_qtd != null ? Number(ins.alarme_qtd) : null
      const diasAlarme = consumoDiario && consumoDiario > 0 && alarmeQtd
        ? Math.round(alarmeQtd / consumoDiario) : null
      const lowStock = alarmeQtd !== null && saldoAtual <= alarmeQtd

      const { rows: entradas } = await pool.query(`
        SELECT id, quantidade, custo_total AS "custoTotal", data, observacao
        FROM dtf_insumo_entradas WHERE insumo_id = $1
        ORDER BY data DESC, created_at DESC LIMIT 30
      `, [ins.id])

      const { rows: saidas } = await pool.query(`
        SELECT id, quantidade, data, observacao, impressora_id AS "impressoraId"
        FROM dtf_insumo_saidas WHERE insumo_id = $1
        ORDER BY data DESC, created_at DESC LIMIT 30
      `, [ins.id])

      return {
        id: ins.id,
        nome: ins.nome,
        unidade: ins.unidade,
        grupo: ins.grupo,
        alarmeQtd,
        diasAlarme,
        saldoAtual,
        consumoMedioPorMetro,
        diasRestantes,
        lowStock,
        entradas,
        saidas,
      }
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
