import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Vincula cada dtf_pedido ao ciclo (bobina de film / refil de tinta-poliamida)
// que estava realmente ativo quando os metros foram registrados. Substitui a
// inferência por timestamp (impressora_id + created_at >= aberta_em) — que
// deixava pedidos sem nenhum ciclo quando criados antes de uma troca mas
// concluídos depois — por um vínculo gravado uma única vez.
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS film_bobina_id INTEGER REFERENCES dtf_film_bobinas(id)`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS refil_ids INTEGER[]`)

    await client.query("BEGIN")

    // Backfill best-effort com a mesma janela de tempo que já era usada —
    // não muda nenhum número já congelado em ciclos fechados (metros_usados/
    // desperdicio_m continuam vindo dessas colunas, não recalculados aqui).
    const { rows: filmBackfilled } = await client.query(`
      UPDATE dtf_pedidos p
      SET film_bobina_id = b.id
      FROM dtf_film_bobinas b
      WHERE p.film_bobina_id IS NULL
        AND p.impressora_id = b.impressora_id
        AND p.created_at >= b.aberta_em
        AND (b.fechada_em IS NULL OR p.created_at < b.fechada_em)
        AND p.status != 'cancelado'
      RETURNING p.id
    `)

    const { rows: refilBackfilled } = await client.query(`
      UPDATE dtf_pedidos p
      SET refil_ids = sub.ids
      FROM (
        SELECT p2.id, array_agg(r.id) AS ids
        FROM dtf_pedidos p2
        JOIN dtf_printer_refis r
          ON r.impressora_id = p2.impressora_id
          AND p2.created_at >= r.aberta_em
          AND (r.fechada_em IS NULL OR p2.created_at < r.fechada_em)
        WHERE p2.refil_ids IS NULL AND p2.status != 'cancelado'
        GROUP BY p2.id
      ) sub
      WHERE p.id = sub.id
      RETURNING p.id
    `)

    await client.query("COMMIT")
    return NextResponse.json({
      ok: true,
      filmVinculados: filmBackfilled.length,
      refilVinculados: refilBackfilled.length,
    })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
