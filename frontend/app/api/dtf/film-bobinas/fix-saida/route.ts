import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-shot: corrige saída id=11 de 1m → 100m (bobina 3 deduziu errado)
export async function POST() {
  try {
    const { rows } = await pool.query(`
      UPDATE dtf_insumo_saidas
      SET quantidade = 100
      WHERE id = 11 AND quantidade = 1
      RETURNING id, quantidade
    `)
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, message: "Saída id=11 não encontrada ou já corrigida" })
    }
    return NextResponse.json({ ok: true, updated: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
