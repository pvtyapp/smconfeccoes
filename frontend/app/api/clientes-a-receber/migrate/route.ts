import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Pagamento parcial de cobranças + cobrança automática de vencido.
export async function POST() {
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`)
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0`)
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS receivable_payments (
        id         SERIAL PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('produto', 'dtf')),
        order_id   INTEGER NOT NULL,
        amount     NUMERIC(10,2) NOT NULL,
        method     TEXT,
        notes      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_receivable_payments_order
        ON receivable_payments(kind, order_id)
    `)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
