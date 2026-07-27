import { pool } from "@/lib/db"
import { evolutionProvider } from "./evolutionProvider"
import { wppconnectProvider } from "./wppconnectProvider"
import type { WhatsAppProvider } from "./types"

export type { WhatsAppProvider } from "./types"
export * from "./types"

// Troca de provedor é 1 valor em app_settings, não deploy — mas atenção:
// findChats/findMessages do WppConnectProvider devolvem o shape NATIVO do
// WPPConnect (não Baileys/Evolution). Quem consome isso hoje (webhook, sync,
// thread, group-messages) foi escrito pro shape da Evolution — trocar pra
// 'wppconnect' em produção quebra esses consumidores até a Fase 3/4
// reescrever os parsers. Seguro pra testar hoje: conexão, QR, criação de
// sessão, envio de texto/mídia — não seguro ainda pra: sync de histórico,
// webhook de entrada, download de mídia recebida.
export async function getProvider(): Promise<WhatsAppProvider> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'whatsapp_provider'`
    )
    const configured = rows[0]?.value as string | undefined
    if (configured === "wppconnect") {
      return wppconnectProvider
    }
    return evolutionProvider
  } catch {
    return evolutionProvider
  }
}
