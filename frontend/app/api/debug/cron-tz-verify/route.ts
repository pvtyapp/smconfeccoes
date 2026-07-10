import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário: compara a expressão antiga (confusa) contra a nova, pra
// confirmar que a correção do agendador de campanha (marketing_schedules)
// calcula "hoje" certo antes de confiar nela em produção.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        NOW() AS now_utc,
        CURRENT_DATE AS current_date_raw,
        (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo') AS old_expr,
        (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS new_expr,
        (NOW() AT TIME ZONE 'America/Sao_Paulo') AS now_brt
    `)
    const { rows: schedules } = await pool.query(`
      SELECT id, name, active, last_executed_at,
             DATE(last_executed_at AT TIME ZONE 'America/Sao_Paulo') AS last_exec_brt_date,
             (last_executed_at IS NULL
               OR DATE(last_executed_at AT TIME ZONE 'America/Sao_Paulo') < (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')) AS due_old,
             (last_executed_at IS NULL
               OR DATE(last_executed_at AT TIME ZONE 'America/Sao_Paulo') < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS due_new
      FROM marketing_schedules
    `).catch(() => ({ rows: [] }))
    return NextResponse.json({ ok: true, ...rows[0], schedules })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
