import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params

    const { rows } = await client.query(`
      SELECT b.id, b.impressora_id, b.tamanho_m,
             COALESCE(
               (SELECT SUM(COALESCE(p.metros_finais, p.metros, 0))
                FROM dtf_pedidos p
                WHERE p.film_bobina_id = b.id AND p.status != 'cancelado'),
               0
             )::float AS metros_usados
      FROM dtf_film_bobinas b
      WHERE b.id = $1 AND b.fechada_em IS NULL
    `, [id])

    if (!rows[0]) return NextResponse.json({ error: "Bobina não encontrada ou já fechada" }, { status: 404 })

    const metrosUsados = Number(rows[0].metros_usados)
    const desperdicio  = Math.max(0, Number(rows[0].tamanho_m) - metrosUsados)

    await client.query(`
      UPDATE dtf_film_bobinas
      SET fechada_em = NOW(), metros_usados = $2, desperdicio_m = $3
      WHERE id = $1
    `, [id, metrosUsados, desperdicio])

    return NextResponse.json({ ok: true, metrosUsados, desperdicioM: desperdicio })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
