import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PUT { date: "YYYY-MM-DD", valor: number | null }
// valor null apaga o registro — o dia volta a usar receita estimada (markup%).
export async function PUT(req: Request) {
  try {
    const { date, valor } = await req.json() as { date?: string; valor?: number | null }
    if (!date) return NextResponse.json({ error: "date é obrigatório" }, { status: 400 })

    if (valor == null) {
      await pool.query(`DELETE FROM marketplace_daily_revenue WHERE date = $1`, [date])
      return NextResponse.json({ date, receitaReal: null })
    }

    if (valor < 0) return NextResponse.json({ error: "valor inválido" }, { status: 400 })

    await pool.query(`
      INSERT INTO marketplace_daily_revenue (date, receita_real, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (date) DO UPDATE SET receita_real = $2, updated_at = now()
    `, [date, valor])

    return NextResponse.json({ date, receitaReal: valor })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
