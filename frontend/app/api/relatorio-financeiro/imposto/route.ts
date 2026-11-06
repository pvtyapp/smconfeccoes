import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { exigirFinanceiro } from "@/lib/acesso"

// Alíquota de imposto sobre a venda usada no DRE do Relatório Financeiro (PIV 06/11).
// PUT { aliquota: number } em %, de 0 a 30.
export async function PUT(req: Request) {
  const semPermissao = await exigirFinanceiro()
  if (semPermissao) return semPermissao
  try {
    const body = await req.json().catch(() => ({}))
    const aliquota = Number(String(body?.aliquota ?? "").replace(",", "."))
    if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 30) {
      return NextResponse.json({ error: "Informe a alíquota em %, entre 0 e 30." }, { status: 400 })
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('dre_aliquota_imposto', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(aliquota)],
    )
    return NextResponse.json({ ok: true, aliquota })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
