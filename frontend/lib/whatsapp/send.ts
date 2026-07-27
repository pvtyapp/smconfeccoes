import { getProvider } from "@/lib/whatsapp/provider"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export type QuotedMsg = {
  id: string
  fromMe: boolean
  remoteJid: string
  content: string
}

// Throws if Evolution is not connected — prevents Baileys from queuing a message
// that will loop forever in retry when the socket is broken.
async function assertEvolutionOpen(): Promise<void> {
  const provider = await getProvider()
  const { state, ok, httpStatus } = await provider.getConnectionState(EVO_INSTANCE, 4_000)
  if (!ok) throw new Error(`Evolution status check falhou (${httpStatus ?? "network_error"})`)
  if (state !== "open") {
    throw new Error(`WhatsApp desconectado (state=${state ?? "unknown"}) — tente novamente em instantes`)
  }
}

export async function sendWhatsApp(jid: string, text: string, quoted?: QuotedMsg) {
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) {
    throw new Error("Evolution API não configurada (vars ausentes)")
  }

  await assertEvolutionOpen()

  // Contato @lid: manda o jid completo com sufixo — a Evolution espera o LID inteiro
  // pra contas migradas, tirar o sufixo vira um "número" inválido e o envio falha.
  // Pra @s.whatsapp.net/@g.us, sim, manda só os dígitos (telefone ou id do grupo).
  const number = jid.endsWith("@lid")
    ? jid
    : jid
        .replace("@s.whatsapp.net", "")
        .replace("@g.us", "")
        .replace(/:[0-9]+$/, "") // strip :15 device number

  const provider = await getProvider()
  const result = await provider.sendText(number, text, {
    quoted,
    instanceName: EVO_INSTANCE,
    timeoutMs: 9_000,
  })
  return result.raw
}
