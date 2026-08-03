import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Envia WhatsApp E salva em wa_messages — usado por toda rota que dispara mensagem
// automática pro cliente (pagamento confirmado, status de pedido, lembrete, etc).
// Antes cada rota reimplementava isso (ou esquecia de salvar): a mensagem chegava
// de verdade pro cliente mas ficava invisível na conversa aqui dentro.
export async function sendAndSave(contactId: number, jid: string, text: string): Promise<void> {
  let msgId: string | null = null
  let ok = true
  try {
    const result = await sendWhatsApp(jid, text) as { key?: { id?: string } }
    msgId = result?.key?.id ?? null
  } catch (e) {
    ok = false
    console.error("[sendAndSave] falhou:", jid, e instanceof Error ? e.message : e)
  }
  // Grava mesmo quando falha — sem isso a mensagem falhada some, ninguém no chat
  // sabe que o aviso automatico (pedido pronto, pagamento etc.) nao chegou.
  await pool.query(
    `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, created_at)
     VALUES ($1, $2, 'out', $3, $4, NOW())
     ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
    [contactId, msgId, text, ok ? "sent" : "failed"]
  ).catch(() => {})
}
