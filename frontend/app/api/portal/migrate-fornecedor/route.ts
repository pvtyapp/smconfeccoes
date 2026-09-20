import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fornecedor_solicitacoes (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        phone           TEXT NOT NULL,
        business_name   TEXT,
        purchase_notes  TEXT,
        status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
        contact_id      INTEGER REFERENCES wa_contacts(id),
        reviewed_by     TEXT,
        reviewed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fornecedor_solicitacoes_status ON fornecedor_solicitacoes(status)`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS fornecedor_fixo_since TIMESTAMPTZ`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
