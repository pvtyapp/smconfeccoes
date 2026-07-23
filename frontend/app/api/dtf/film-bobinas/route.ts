import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET — estado atual por impressora + histórico
export async function GET() {
  try {
    const { rows: ativas } = await pool.query(`
      SELECT b.id, b.impressora_id AS "impressoraId", b.tamanho_m AS "tamanhoM",
             b.aberta_em AS "abertaEm", b.obs,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.film_bobina_id = b.id AND p.status != 'cancelado'),
               0
             )::float AS "metrosUsadosPedidos",
             COALESCE(
               (SELECT SUM(u.metros) FROM dtf_pedido_bobina_uso u WHERE u.bobina_id = b.id AND u.status = 'reservado'),
               0
             )::float AS "metrosReservados",
             COALESCE(
               (SELECT SUM(u.metros) FROM dtf_pedido_bobina_uso u WHERE u.bobina_id = b.id AND u.status = 'confirmado'),
               0
             )::float AS "metrosConfirmados"
      FROM dtf_film_bobinas b
      WHERE b.fechada_em IS NULL
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

    // Pedidos em produção vinculados a cada bobina ativa — usado pelo passo
    // "abrir bobina nova" pra listar quem pode precisar de reserva na próxima.
    const bobinaIds = ativas.map(b => b.id)
    let pedidosPorBobina: Record<number, object[]> = {}
    if (bobinaIds.length > 0) {
      const { rows: pedidos } = await pool.query(`
        SELECT p.film_bobina_id AS "bobinaId", p.id, p.number, p.status,
               COALESCE(p.metros_finais, p.metros, 0)::float AS metros
        FROM dtf_pedidos p
        WHERE p.film_bobina_id = ANY($1::int[]) AND p.status != 'cancelado'
        ORDER BY p.created_at
      `, [bobinaIds])
      pedidosPorBobina = pedidos.reduce((acc: Record<number, object[]>, p) => {
        const key = p.bobinaId as number
        if (!acc[key]) acc[key] = []
        acc[key].push(p)
        return acc
      }, {})
    }

    const result = ativas.map(b => {
      const comprometido = Number(b.metrosUsadosPedidos) + Number(b.metrosReservados) + Number(b.metrosConfirmados)
      return {
        id: b.id,
        impressoraId: b.impressoraId,
        tamanhoM: b.tamanhoM,
        abertaEm: b.abertaEm,
        obs: b.obs,
        metrosUsados: Number(b.metrosUsadosPedidos) + Number(b.metrosConfirmados),
        metrosReservados: Number(b.metrosReservados),
        metrosRestantes: Number(b.tamanhoM) - comprometido,
        pctUsado: Number(b.tamanhoM) > 0 ? (comprometido / Number(b.tamanhoM)) * 100 : 0,
        pedidos: pedidosPorBobina[b.id] ?? [],
        historico: porImpressora[b.impressoraId as number] ?? [],
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — instalar nova bobina (fecha a anterior automaticamente)
export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const {
      impressoraId,
      tamanhoM = 100,
      obs,
      reservas = [] as { pedidoId: number; metros: number }[],
    } = await req.json()
    if (!impressoraId) return NextResponse.json({ error: "impressoraId obrigatorio" }, { status: 400 })

    await client.query("BEGIN")

    // Bobina ativa anterior (se existir)
    const { rows: ativas } = await client.query(`
      SELECT id, tamanho_m FROM dtf_film_bobinas WHERE impressora_id = $1 AND fechada_em IS NULL
    `, [impressoraId])

    // Congela, pra cada pedido reservado, quanto já é da bobina antiga —
    // isso precisa acontecer ANTES de somar o desperdício dela, senão o
    // pedido inteiro (10m) cairia na bobina antiga que só tinha 5m de fato.
    for (const ativa of ativas) {
      for (const r of reservas) {
        const metrosReservado = Number(r.metros)
        if (!r.pedidoId || !(metrosReservado > 0)) continue

        const { rows: pedidoRows } = await client.query(`
          SELECT id, COALESCE(metros_finais, metros, 0)::float AS total_conhecido
          FROM dtf_pedidos
          WHERE id = $1 AND film_bobina_id = $2 AND status != 'cancelado'
        `, [r.pedidoId, ativa.id])
        if (!pedidoRows[0]) continue // não pertence a essa bobina — ignora

        const metrosAntiga = Math.max(0, Number(pedidoRows[0].total_conhecido) - metrosReservado)
        await client.query(
          `UPDATE dtf_pedidos SET metros_bobina_antiga = $2 WHERE id = $1`,
          [r.pedidoId, metrosAntiga]
        )
      }
    }

    // Fecha a(s) bobina(s) ativa(s) — desperdício sempre calculado, nunca perguntado.
    for (const ativa of ativas) {
      const { rows: usoRows } = await client.query(`
        SELECT
          COALESCE(
            (SELECT SUM(COALESCE(metros_bobina_antiga, metros_finais, metros, 0))
             FROM dtf_pedidos WHERE film_bobina_id = $1 AND status != 'cancelado'),
            0
          ) +
          COALESCE(
            (SELECT SUM(metros) FROM dtf_pedido_bobina_uso WHERE bobina_id = $1),
            0
          ) AS metros_usados
      `, [ativa.id])
      const metrosUsados = Number(usoRows[0].metros_usados)
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
    const novaBobinaId = rows[0].id

    // Validar reservas: têm que caber na bobina nova
    const totalReservado = reservas.reduce((s: number, r: { metros: number }) => s + (Number(r.metros) || 0), 0)
    if (totalReservado > tamanhoM) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: `Reservas somam ${totalReservado.toFixed(2)} m, maior que os ${tamanhoM} m da bobina nova.` },
        { status: 422 }
      )
    }

    // Grava a reserva provisória — vira definitiva quando o pedido chegar em "Pronto"
    for (const r of reservas) {
      const metros = Number(r.metros)
      if (!r.pedidoId || !(metros > 0)) continue
      await client.query(`
        INSERT INTO dtf_pedido_bobina_uso (pedido_id, bobina_id, metros, status)
        VALUES ($1, $2, $3, 'reservado')
      `, [r.pedidoId, novaBobinaId, metros])
    }

    await client.query("COMMIT")
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
