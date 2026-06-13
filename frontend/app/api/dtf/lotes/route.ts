import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"

export async function GET() {
  try {
    const { rows: insumos } = await pool.query(`
      SELECT i.id, i.nome, i.unidade,
        json_agg(
          json_build_object(
            'id',              l.id,
            'custo',           l.custo,
            'quantidade',      l.quantidade,
            'abertoEm',        l.aberto_em,
            'fechadoEm',       l.fechado_em,
            'metrosNoPeriodo', l.metros_no_periodo,
            'custoPorMetro',   l.custo_por_metro
          ) ORDER BY l.aberto_em DESC, l.created_at DESC
        ) FILTER (WHERE l.id IS NOT NULL) AS lotes
      FROM dtf_insumos i
      LEFT JOIN dtf_insumo_lotes l ON l.insumo_id = i.id
      GROUP BY i.id, i.nome, i.unidade
      ORDER BY i.id
    `)

    // Para cada insumo com lote ativo, calcula metros acumulados desde abertura
    const today = todayBR()
    const result = await Promise.all(insumos.map(async (ins) => {
      const lotes = ins.lotes || []
      const ativo = lotes.find((l: { fechadoEm: string | null }) => !l.fechadoEm)
      if (ativo) {
        const { rows } = await pool.query(`
          SELECT COALESCE(SUM(metros), 0) AS total
          FROM dtf_pedidos
          WHERE data >= $1 AND data <= $2
        `, [ativo.abertoEm, today])
        ativo.metrosAcumulados = Number(rows[0].total)
        ativo.custoPorMetroAtual = ativo.metrosAcumulados > 0
          ? Number(ativo.custo) / ativo.metrosAcumulados
          : null
      }
      return { ...ins, lotes }
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { insumoId, custo, quantidade, abertoEm } = await req.json()
    if (!insumoId || !custo || !quantidade || !abertoEm)
      return NextResponse.json({ error: "Campos obrigatórios: insumoId, custo, quantidade, abertoEm" }, { status: 400 })

    await client.query("BEGIN")

    // Fecha lote anterior (se existir)
    const { rows: ativos } = await client.query(`
      SELECT id, aberto_em FROM dtf_insumo_lotes
      WHERE insumo_id = $1 AND fechado_em IS NULL
    `, [insumoId])

    if (ativos.length > 0) {
      const loteAtivo = ativos[0]
      const { rows: metrosRows } = await client.query(`
        SELECT COALESCE(SUM(metros), 0) AS total
        FROM dtf_pedidos
        WHERE data >= $1 AND data <= $2
      `, [loteAtivo.aberto_em, abertoEm])

      const metros = Number(metrosRows[0].total)
      const { rows: custoRows } = await client.query(
        `SELECT custo FROM dtf_insumo_lotes WHERE id = $1`, [loteAtivo.id]
      )
      const custoLote = Number(custoRows[0].custo)
      const custoPorMetro = metros > 0 ? custoLote / metros : null

      await client.query(`
        UPDATE dtf_insumo_lotes
        SET fechado_em = $1, metros_no_periodo = $2, custo_por_metro = $3
        WHERE id = $4
      `, [abertoEm, metros, custoPorMetro, loteAtivo.id])
    }

    // Cria novo lote
    const { rows } = await client.query(`
      INSERT INTO dtf_insumo_lotes (insumo_id, custo, quantidade, aberto_em)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [insumoId, custo, quantidade, abertoEm])

    await client.query("COMMIT")
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
