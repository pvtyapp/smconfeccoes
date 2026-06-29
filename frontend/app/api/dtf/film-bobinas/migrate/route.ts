import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dtf_film_bobinas (
        id            SERIAL PRIMARY KEY,
        impressora_id INTEGER NOT NULL,
        tamanho_m     NUMERIC(10,2) NOT NULL DEFAULT 100.00,
        aberta_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fechada_em    TIMESTAMPTZ,
        metros_usados NUMERIC(10,2),
        desperdicio_m NUMERIC(10,2),
        obs           TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_film_bobinas_impressora ON dtf_film_bobinas(impressora_id)`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
