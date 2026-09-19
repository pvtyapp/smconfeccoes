import { pool } from "@/lib/db"

// Só pro aviso (decisão 5) — nunca bloqueia o pedido. Site aceita 24/7;
// isso só decide se mostra "separação começa no próximo horário comercial".
// Mesma lógica de getServiceStatus('produto', ...) do webhook, sem o check
// de produto_ativo — essa chave é sobre o chatbot tirar pedido, não sobre o site.
export async function isOutsideBusinessHours(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings
     WHERE key IN ('produto_horario_dias', 'produto_horario_inicio', 'produto_horario_fim', 'produto_fechado_ate')`
  )
  const s: Record<string, string> = {}
  for (const r of rows) s[r.key] = r.value

  const fechadoAte = s.produto_fechado_ate
  if (fechadoAte && new Date(fechadoAte) > new Date()) return true

  const dias = s.produto_horario_dias
  const inicio = s.produto_horario_inicio
  const fim = s.produto_horario_fim
  if (dias && inicio && fim) {
    const nowBR = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    const currentDay = nowBR.getDay()
    const hh = String(nowBR.getHours()).padStart(2, "0")
    const mm = String(nowBR.getMinutes()).padStart(2, "0")
    const currentTime = `${hh}:${mm}`
    const allowedDays = dias.split(",").map(Number)
    if (!allowedDays.includes(currentDay) || currentTime < inicio || currentTime > fim) return true
  }
  return false
}
