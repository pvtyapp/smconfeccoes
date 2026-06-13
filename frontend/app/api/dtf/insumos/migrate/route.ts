import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_insumo_entradas (
        id          SERIAL PRIMARY KEY,
        insumo_id   INT NOT NULL REFERENCES dtf_insumos(id),
        quantidade  NUMERIC(10,3) NOT NULL,
        custo_total NUMERIC(10,2),
        data        DATE NOT NULL DEFAULT CURRENT_DATE,
        observacao  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_insumo_saidas (
        id         SERIAL PRIMARY KEY,
        insumo_id  INT NOT NULL REFERENCES dtf_insumos(id),
        quantidade NUMERIC(10,3) NOT NULL,
        data       DATE NOT NULL DEFAULT CURRENT_DATE,
        observacao TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query(`
      ALTER TABLE dtf_insumos ADD COLUMN IF NOT EXISTS alarme_qtd NUMERIC(10,3)
    `)

    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS preco_por_metro BOOLEAN DEFAULT FALSE
    `)

    await client.query(`
      ALTER TABLE dtf_insumos ADD COLUMN IF NOT EXISTS grupo TEXT
    `)

    await client.query(`
      UPDATE dtf_insumos SET grupo = nome WHERE grupo IS NULL
    `)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
