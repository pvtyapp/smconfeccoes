import { pool } from "@/lib/db"

// Colunas das ferramentas novas do chat (PIV 05/11): reação (eu/cliente) e editada.
let colunasOk = false
export async function garantirColunasChat() {
  if (colunasOk) return
  await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS reactions JSONB`)
  await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`)
  colunasOk = true
}
