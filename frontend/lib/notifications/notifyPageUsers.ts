import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Avisa por WhatsApp todo operador ativo que tem acesso a uma aba específica
// (ou é admin) — reaproveita a mesma allowed_pages já usada pra liberar tela no
// painel e comando no bot administrativo, sem precisar de um cadastro separado
// de "quem recebe aviso de quê".
export async function notifyPageUsers(page: string, message: string): Promise<void> {
  const { rows } = await pool.query(`
    SELECT phone FROM users
    WHERE active = true AND chatbot_admin_enabled = true AND phone IS NOT NULL
      AND (is_admin = true OR allowed_pages @> ARRAY[$1]::text[])
  `, [page]).catch(() => ({ rows: [] as { phone: string }[] }))

  for (const { phone } of rows) {
    const jid = `55${phone}@s.whatsapp.net`
    await sendWhatsApp(jid, message).catch(e =>
      console.error("[notifyPageUsers] falhou pra", phone, e instanceof Error ? e.message : e)
    )
  }
}
