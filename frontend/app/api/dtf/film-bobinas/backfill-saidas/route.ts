import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-shot: cria saídas retroativas para bobinas sem insumo_saida_id
export async function POST() {
  const client = await pool.connect()
  try {
    const { rows: filmRows } = await client.query(
      `SELECT id FROM dtf_insumos WHERE LOWER(grupo) = 'film' ORDER BY id LIMIT 1`
    )
    if (filmRows.length === 0) {
      return NextResponse.json(
        { error: "Insumo de Film não encontrado. Cadastre um insumo no grupo 'Film' primeiro." },
        { status: 422 }
      )
    }
    const filmId = filmRows[0].id

    const { rows: bobinas } = await client.query(`
      SELECT id, impressora_id, aberta_em
      FROM dtf_film_bobinas
      WHERE insumo_saida_id IS NULL
      ORDER BY aberta_em ASC
    `)

    if (bobinas.length === 0) {
      return NextResponse.json({ ok: true, created: 0, message: "Nenhuma bobina sem saída encontrada." })
    }

    await client.query("BEGIN")

    let created = 0
    for (const b of bobinas) {
      const data = new Date(b.aberta_em).toISOString().slice(0, 10)
      const { rows: saidaRows } = await client.query(`
        INSERT INTO dtf_insumo_saidas (insumo_id, quantidade, data, observacao, impressora_id)
        VALUES ($1, 1, $2, $3, $4)
        RETURNING id
      `, [filmId, data, `Bobina instalada — Impressora ${b.impressora_id} [retroativo]`, b.impressora_id])

      await client.query(`
        UPDATE dtf_film_bobinas SET insumo_saida_id = $1 WHERE id = $2
      `, [saidaRows[0].id, b.id])

      created++
    }

    await client.query("COMMIT")
    return NextResponse.json({ ok: true, created, filmInsumoId: filmId })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
