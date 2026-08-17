import { pool } from "@/lib/db"

// Disjuntor geral: quando ligado, NENHUMA mensagem automática sai pro cliente
// (kanban, cobrança, lifecycle, reservas, ack de arquivo, resposta reativa do
// bot) — só o que o operador manda na mão pelo chat continua funcionando.
// Ponto único de verdade; sendAndSave() e replyAndSave() checam por aqui.
export async function isAutomationPaused(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'automacao_pausada'`
  ).catch(() => ({ rows: [] as { value: string }[] }))
  return rows[0]?.value === "true"
}
