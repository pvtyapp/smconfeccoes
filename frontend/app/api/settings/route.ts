import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const ALLOWED_KEYS = new Set([
  "nome_empresa", "endereco_retirada", "pix_key",
  "chatbot_ativo", "pedidos_auto", "lifecycle_ativo",
  "dtf_ativo", "dtf_preco_por_metro",
  "dtf_horario_dias", "dtf_horario_inicio", "dtf_horario_fim", "dtf_fechado_ate",
  "produto_ativo",
  "produto_horario_dias", "produto_horario_inicio", "produto_horario_fim", "produto_fechado_ate",
  "novo_d2_msg",
  "ausente_d15_msg", "ausente_d30_msg", "ausente_d45_msg",
  "controle_estoque_ativo", "reserva_expiry_hours", "chatbot_idle_return_minutes", "print_receipt_printer",
  "dtf_num_impressoras",
  "dtf_film_alerta_m", "dtf_film_tamanho_padrao",
])

export async function GET() {
  try {
    const { rows } = await pool.query(`SELECT key, value FROM app_settings ORDER BY key`)
    const settings: Record<string, string> = {}
    for (const row of rows) settings[row.key] = row.value
    return NextResponse.json(settings)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, string>
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      for (const [key, value] of Object.entries(body)) {
        if (!ALLOWED_KEYS.has(key)) continue
        await client.query(`
          INSERT INTO app_settings (key, value)
          VALUES ($1, $2)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, String(value)])
      }
      await client.query("COMMIT")
      return NextResponse.json({ ok: true })
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
