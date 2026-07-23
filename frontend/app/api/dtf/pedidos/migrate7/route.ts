import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Suporte a pedido partido entre 2 bobinas de Film (quando a bobina esgota
// no meio da impressão). metros_bobina_antiga congela, no momento da troca,
// quanto desse pedido já pertence à bobina que está fechando — o resto vira
// reserva na bobina nova via dtf_pedido_bobina_uso, confirmada de verdade só
// quando o pedido chega em "pronto" (metragem final real).
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS metros_bobina_antiga NUMERIC`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_pedido_bobina_uso (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER NOT NULL REFERENCES dtf_pedidos(id) ON DELETE CASCADE,
        bobina_id INTEGER NOT NULL REFERENCES dtf_film_bobinas(id) ON DELETE CASCADE,
        metros NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'reservado' CHECK (status IN ('reservado', 'confirmado')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pedido_bobina_uso_bobina ON dtf_pedido_bobina_uso(bobina_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pedido_bobina_uso_pedido ON dtf_pedido_bobina_uso(pedido_id)`)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
