import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Avisa por WhatsApp todo operador que assinou um tipo de aviso específico
// (notification_subscriptions) — independente de aba do painel e de comando
// do bot, é opt-in próprio (ex: "avisar quando ordem entra pra revisão"),
// marcado em Usuários. Só manda pra quem também tem o chatbot ligado.
export async function notifySubscribers(key: string, message: string): Promise<void> {
  const { rows } = await pool.query(`
    SELECT phone FROM users
    WHERE active = true AND chatbot_admin_enabled = true AND phone IS NOT NULL
      AND notification_subscriptions @> ARRAY[$1]::text[]
  `, [key]).catch(() => ({ rows: [] as { phone: string }[] }))

  for (const { phone } of rows) {
    const jid = `55${phone}@s.whatsapp.net`
    await sendWhatsApp(jid, message).catch(e =>
      console.error("[notifySubscribers] falhou pra", phone, e instanceof Error ? e.message : e)
    )
  }
}
