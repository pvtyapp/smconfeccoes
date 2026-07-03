import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/admin/migrate-prod
// Idempotent — safe to run multiple times.
// Creates: prod_order_logs, size_weights
// Alters:  prod_order_materials (adds color column)
export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prod_order_logs (
        id         SERIAL PRIMARY KEY,
        order_id   INT NOT NULL,
        event      TEXT NOT NULL,
        payload    JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prod_order_logs_order_id
        ON prod_order_logs (order_id)
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS size_weights (
        id         SERIAL PRIMARY KEY,
        product_id INT,
        size       TEXT NOT NULL,
        weight     NUMERIC NOT NULL DEFAULT 1.0,
        UNIQUE (product_id, size)
      )
    `)

    // Default global weights (product_id NULL = applies to all products)
    await pool.query(`
      INSERT INTO size_weights (product_id, size, weight) VALUES
        (NULL, 'PP',   0.85),
        (NULL, 'P',    1.00),
        (NULL, 'M',    1.10),
        (NULL, 'G',    1.20),
        (NULL, 'GG',   1.40),
        (NULL, 'XGG',  1.60),
        (NULL, 'XXXL', 1.80)
      ON CONFLICT DO NOTHING
    `)

    await pool.query(`
      ALTER TABLE prod_order_materials ADD COLUMN IF NOT EXISTS color TEXT
    `)

    return NextResponse.json({ success: true, message: "Migração concluída" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
