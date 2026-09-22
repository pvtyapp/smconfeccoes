import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"

// Grupo "SM Financeiro" no WhatsApp (criado em 2026-09-22, roda na instância
// dedicada sm-admin) — canal de AVISOS AUTOMÁTICOS, sem menu de comando. Não
// confundir com "SM Administrativo" (bot completo de comandos, adminBot.ts),
// que continua exatamente como está.
export const FINANCEIRO_GROUP_JID = "120363430722628180@g.us"

// Manda pro grupo Financeiro sempre pela instância admin dedicada (nunca a
// principal, que não participa desse grupo) — ver instanceContext.ts pro
// porquê do override explícito ser necessário aqui (cron não passa pelo
// webhook, não tem contexto de instância pra herdar).
export async function sendFinanceiro(text: string): Promise<void> {
  const instance = await getAdminInstanceName()
  if (!instance) {
    console.error("[financeiro] admin_instance_name não configurado — aviso não enviado:", text.slice(0, 60))
    return
  }
  await sendWhatsApp(FINANCEIRO_GROUP_JID, text, undefined, instance).catch(e =>
    console.error("[financeiro] envio falhou:", e instanceof Error ? e.message : e)
  )
}
