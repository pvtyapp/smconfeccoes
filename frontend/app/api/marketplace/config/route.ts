import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Config única do financeiro do marketplace: markup% usado pra estimar
// receita nos dias em que ninguém digitou o valor real vendido.
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT markup_percent AS "markupPercent" FROM marketplace_config WHERE id = 1`
    )
    return NextResponse.json({ markupPercent: Number(rows[0]?.markupPercent ?? 50) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const { markupPercent } = await req.json() as { markupPercent?: number }
    if (markupPercent == null || markupPercent < 0) {
      return NextResponse.json({ error: "markupPercent inválido" }, { status: 400 })
    }
    await pool.query(
      `UPDATE marketplace_config SET markup_percent = $1 WHERE id = 1`,
      [markupPercent]
    )
    return NextResponse.json({ markupPercent })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
