import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows: ativos } = await pool.query(`
      SELECT r.id, r.impressora_id AS "impressoraId", r.insumo_id AS "insumoId",
             i.nome AS "insumoNome", i.unidade, i.grupo,
             r.quantidade, r.custo_total AS "custoTotal",
             r.aberta_em AS "abertaEm", r.obs,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.impressora_id = r.impressora_id
                  AND p.created_at >= r.aberta_em
                  AND p.status != 'cancelado'),
               0
             )::float AS "metrosAtuais"
      FROM dtf_printer_refis r
      JOIN dtf_insumos i ON i.id = r.insumo_id
      WHERE r.fechada_em IS NULL
      ORDER BY r.impressora_id, i.nome
    `)

    const { rows: historico } = await pool.query(`
      SELECT r.id, r.impressora_id AS "impressoraId", r.insumo_id AS "insumoId",
             i.nome AS "insumoNome", i.unidade, i.grupo,
             r.quantidade, r.custo_total AS "custoTotal",
             r.aberta_em AS "abertaEm", r.fechada_em AS "fechadaEm",
             r.metros_no_ciclo AS "metrosNoCiclo",
             r.custo_por_metro AS "custoPorMetro"
      FROM dtf_printer_refis r
      JOIN dtf_insumos i ON i.id = r.insumo_id
      WHERE r.fechada_em IS NOT NULL
      ORDER BY r.impressora_id, i.nome, r.fechada_em DESC
    `)

    const histMap: Record<string, typeof historico> = {}
    for (const h of historico) {
      const key = `${h.impressoraId}-${h.insumoId}`
      if (!histMap[key]) histMap[key] = []
      histMap[key].push(h)
    }

    const result = ativos.map(a => {
      const metros = Number(a.metrosAtuais)
      const custo = a.custoTotal ? Number(a.custoTotal) : null
      return {
        ...a,
        metrosAtuais: metros,
        custoPorMetroAtual: custo != null && metros > 0 ? custo / metros : null,
        historico: histMap[`${a.impressoraId}-${a.insumoId}`] ?? [],
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { impressoraId, insumoId, quantidade, obs } = await req.json()
    if (!impressoraId || !insumoId || !quantidade)
      return NextResponse.json(
        { error: "impressoraId, insumoId e quantidade são obrigatórios" },
        { status: 400 }
      )

    // Custo unitário médio ponderado das entradas — preço vem do estoque, não do body
    const { rows: costRows } = await pool.query(`
      SELECT SUM(custo_total) / NULLIF(SUM(quantidade), 0) AS custo_unitario
      FROM dtf_insumo_entradas
      WHERE insumo_id = $1 AND custo_total IS NOT NULL
    `, [insumoId])
    const custoUnitario: number | null = costRows[0]?.custo_unitario != null
      ? Number(costRows[0].custo_unitario) : null
    const custoTotal = custoUnitario != null ? custoUnitario * Number(quantidade) : null

    await client.query("BEGIN")

    // Close previous active cycle for this impressora+insumo
    const { rows: ativos } = await client.query(`
      SELECT r.id, r.custo_total,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.impressora_id = r.impressora_id
                  AND p.created_at >= r.aberta_em
                  AND p.status != 'cancelado'),
               0
             ) AS metros_ciclo
      FROM dtf_printer_refis r
      WHERE r.impressora_id = $1 AND r.insumo_id = $2 AND r.fechada_em IS NULL
    `, [impressoraId, insumoId])

    for (const ativo of ativos) {
      const metrosCiclo = Number(ativo.metros_ciclo)
      const custoAtivo = ativo.custo_total ? Number(ativo.custo_total) : null
      const custoPorMetro = custoAtivo != null && metrosCiclo > 0 ? custoAtivo / metrosCiclo : null
      await client.query(`
        UPDATE dtf_printer_refis
        SET fechada_em = NOW(), metros_no_ciclo = $2, custo_por_metro = $3
        WHERE id = $1
      `, [ativo.id, metrosCiclo, custoPorMetro])
    }

    // Validate insumo
    const { rows: insumoRows } = await client.query(
      `SELECT id, nome FROM dtf_insumos WHERE id = $1`, [insumoId]
    )
    if (insumoRows.length === 0) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Insumo não encontrado" }, { status: 404 })
    }

    // Check stock
    const { rows: saldoRows } = await client.query(`
      SELECT
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = $1), 0) -
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = $1), 0)
        AS saldo
    `, [insumoId])
    const saldo = Number(saldoRows[0].saldo)
    if (saldo < quantidade) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: `Estoque insuficiente. Disponível: ${parseFloat(saldo.toFixed(3))} — ${insumoRows[0].nome}` },
        { status: 422 }
      )
    }

    // Deduct stock
    const obsText = [insumoRows[0].nome, `Reposição Impressora ${impressoraId}`, obs].filter(Boolean).join(" — ")
    const { rows: saidaRows } = await client.query(`
      INSERT INTO dtf_insumo_saidas (insumo_id, quantidade, data, observacao, impressora_id)
      VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date, $3, $4)
      RETURNING id
    `, [insumoId, quantidade, obsText, impressoraId])
    const saidaId = saidaRows[0].id

    // Open new cycle
    const { rows } = await client.query(`
      INSERT INTO dtf_printer_refis (impressora_id, insumo_id, quantidade, custo_total, obs, insumo_saida_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, impressora_id AS "impressoraId", insumo_id AS "insumoId",
                quantidade, custo_total AS "custoTotal", aberta_em AS "abertaEm"
    `, [impressoraId, insumoId, quantidade, custoTotal ?? null, obs ?? null, saidaId])

    await client.query("COMMIT")
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
