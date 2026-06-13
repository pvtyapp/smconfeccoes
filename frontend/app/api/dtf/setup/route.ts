import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_insumos (
        id        SERIAL PRIMARY KEY,
        nome      TEXT NOT NULL,
        unidade   TEXT NOT NULL DEFAULT 'unidade'
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_insumo_lotes (
        id                SERIAL PRIMARY KEY,
        insumo_id         INTEGER NOT NULL REFERENCES dtf_insumos(id),
        custo             NUMERIC(10,2) NOT NULL,
        quantidade        NUMERIC(10,3) NOT NULL,
        aberto_em         DATE NOT NULL DEFAULT CURRENT_DATE,
        fechado_em        DATE,
        metros_no_periodo NUMERIC(10,2),
        custo_por_metro   NUMERIC(10,4),
        created_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_pedidos (
        id             SERIAL PRIMARY KEY,
        data           DATE NOT NULL DEFAULT CURRENT_DATE,
        cliente        TEXT,
        metros         NUMERIC(10,2) NOT NULL,
        preco_cobrado  NUMERIC(10,2),
        observacao     TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Seed insumos se ainda não existirem
    await client.query(`
      INSERT INTO dtf_insumos (nome, unidade)
      SELECT nome, unidade FROM (VALUES
        ('Tinta',     'litro'),
        ('Film',      'metro'),
        ('Poliamida', 'kg')
      ) AS v(nome, unidade)
      WHERE NOT EXISTS (SELECT 1 FROM dtf_insumos)
    `)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
