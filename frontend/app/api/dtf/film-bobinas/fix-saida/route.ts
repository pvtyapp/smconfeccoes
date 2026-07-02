import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-shot: corrige data da saída id=11 de 2026-07-02 (UTC) → 2026-07-01 (Brasil)
export async function POST() {
  try {
    const { rows } = await pool.query(`
      UPDATE dtf_insumo_saidas
      SET data = '2026-07-01'
      WHERE id = 11 AND data = '2026-07-02'
      RETURNING id, data, quantidade
    `)
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, message: "Saída id=11 não encontrada ou data já corrigida" })
    }
    return NextResponse.json({ ok: true, updated: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
