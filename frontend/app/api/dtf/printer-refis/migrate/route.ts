import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dtf_printer_refis (
        id              SERIAL PRIMARY KEY,
        impressora_id   INTEGER NOT NULL,
        insumo_id       INTEGER NOT NULL REFERENCES dtf_insumos(id),
        quantidade      NUMERIC(10,3) NOT NULL,
        custo_total     NUMERIC(10,2),
        aberta_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fechada_em      TIMESTAMPTZ,
        metros_no_ciclo NUMERIC(10,2),
        custo_por_metro NUMERIC(10,6),
        insumo_saida_id INTEGER REFERENCES dtf_insumo_saidas(id) ON DELETE SET NULL,
        obs             TEXT
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_printer_refis_ativo
        ON dtf_printer_refis(impressora_id, insumo_id)
        WHERE fechada_em IS NULL
    `)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
