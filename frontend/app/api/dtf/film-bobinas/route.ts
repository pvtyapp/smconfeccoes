import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET — estado atual por impressora + histórico
export async function GET() {
  try {
    const { rows: ativas } = await pool.query(`
      SELECT b.id, b.impressora_id AS "impressoraId", b.tamanho_m AS "tamanhoM",
             b.aberta_em AS "abertaEm", b.obs,
             COALESCE(SUM(COALESCE(p.metros_finais, p.metros, 0)), 0)::float AS "metrosUsados"
      FROM dtf_film_bobinas b
      LEFT JOIN dtf_pedidos p
        ON p.impressora_id = b.impressora_id
        AND p.created_at >= b.aberta_em
        AND p.status != 'cancelado'
      WHERE b.fechada_em IS NULL
      GROUP BY b.id, b.impressora_id, b.tamanho_m, b.aberta_em, b.obs
      ORDER BY b.impressora_id
    `)

    const { rows: historico } = await pool.query(`
      SELECT id, impressora_id AS "impressoraId", tamanho_m AS "tamanhoM",
             aberta_em AS "abertaEm", fechada_em AS "fechadaEm",
             metros_usados AS "metrosUsados", desperdicio_m AS "desperdicioM", obs
      FROM dtf_film_bobinas
      WHERE fechada_em IS NOT NULL
      ORDER BY fechada_em DESC
      LIMIT 40
    `)

    const porImpressora: Record<number, object[]> = {}
    for (const h of historico) {
      const imp = h.impressoraId as number
      if (!porImpressora[imp]) porImpressora[imp] = []
      porImpressora[imp].push(h)
    }

    const result = ativas.map(b => ({
      ...b,
      metrosRestantes: Number(b.tamanhoM) - Number(b.metrosUsados),
      pctUsado: Number(b.tamanhoM) > 0 ? (Number(b.metrosUsados) / Number(b.tamanhoM)) * 100 : 0,
      historico: porImpressora[b.impressoraId as number] ?? [],
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — instalar nova bobina (fecha a anterior automaticamente)
export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { impressoraId, tamanhoM = 100, obs } = await req.json()
    if (!impressoraId) return NextResponse.json({ error: "impressoraId obrigatorio" }, { status: 400 })

    await client.query("BEGIN")

    // Fechar bobina ativa anterior se existir
    const { rows: ativas } = await client.query(`
      SELECT b.id, b.tamanho_m,
             COALESCE(SUM(COALESCE(p.metros_finais, p.metros, 0)), 0)::float AS metros_usados
      FROM dtf_film_bobinas b
      LEFT JOIN dtf_pedidos p
        ON p.impressora_id = b.impressora_id
        AND p.created_at >= b.aberta_em
        AND p.status != 'cancelado'
      WHERE b.impressora_id = $1 AND b.fechada_em IS NULL
      GROUP BY b.id, b.tamanho_m
    `, [impressoraId])

    for (const ativa of ativas) {
      const metrosUsados = Number(ativa.metros_usados)
      const desperdicio  = Math.max(0, Number(ativa.tamanho_m) - metrosUsados)
      await client.query(`
        UPDATE dtf_film_bobinas
        SET fechada_em = NOW(), metros_usados = $2, desperdicio_m = $3
        WHERE id = $1
      `, [ativa.id, metrosUsados, desperdicio])
    }

    // Deduzir 1 bobina do estoque de film (grupo = 'Film')
    const { rows: filmRows } = await client.query(
      `SELECT id FROM dtf_insumos WHERE LOWER(grupo) = 'film' ORDER BY id LIMIT 1`
    )
    if (filmRows.length === 0) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: "Insumo de Film não encontrado. Cadastre um insumo no grupo 'Film' antes de usar o monitor." },
        { status: 422 }
      )
    }

    const filmId = filmRows[0].id
    const { rows: saldoRows } = await client.query(`
      SELECT
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_entradas WHERE insumo_id = $1), 0) -
        COALESCE((SELECT SUM(quantidade) FROM dtf_insumo_saidas   WHERE insumo_id = $1), 0)
        AS saldo
    `, [filmId])
    const saldo = Number(saldoRows[0].saldo)
    if (saldo < tamanhoM) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: `Estoque insuficiente. Disponível: ${parseFloat(saldo.toFixed(2))} m` },
        { status: 422 }
      )
    }
    const { rows: saidaRows } = await client.query(`
      INSERT INTO dtf_insumo_saidas (insumo_id, quantidade, data, observacao, impressora_id)
      VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date, $3, $4)
      RETURNING id
    `, [filmId, tamanhoM, `Bobina instalada — Impressora ${impressoraId}`, impressoraId])
    const saidaId = saidaRows[0].id

    // Abrir nova bobina
    const { rows } = await client.query(`
      INSERT INTO dtf_film_bobinas (impressora_id, tamanho_m, obs, insumo_saida_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, impressora_id AS "impressoraId", tamanho_m AS "tamanhoM", aberta_em AS "abertaEm"
    `, [impressoraId, tamanhoM, obs ?? null, saidaId])

    await client.query("COMMIT")
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
