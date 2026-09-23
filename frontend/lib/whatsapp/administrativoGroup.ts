import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"

// Grupo "SM Administrativo" no WhatsApp (instância dedicada sm-admin) — além do
// bot de comandos (adminBot.ts), recebe avisos automáticos que antes iam no
// privado de cada admin (ex: lembrete diário de contas a pagar).
export const ADMINISTRATIVO_GROUP_JID = "120363411610426060@g.us"

// Mesmo motivo do sendFinanceiro: cron não tem contexto de instância pra
// herdar, então a instância admin vai explícita (a principal não está no grupo).
export async function sendAdministrativo(text: string): Promise<void> {
  const instance = await getAdminInstanceName()
  if (!instance) {
    console.error("[administrativo] admin_instance_name não configurado — aviso não enviado:", text.slice(0, 60))
    return
  }
  await sendWhatsApp(ADMINISTRATIVO_GROUP_JID, text, undefined, instance).catch(e =>
    console.error("[administrativo] envio falhou:", e instanceof Error ? e.message : e)
  )
}
