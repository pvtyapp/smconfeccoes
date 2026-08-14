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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Throws if Evolution is not connected — prevents Baileys from queuing a message
// that will loop forever in retry when the socket is broken. Tenta 3 vezes com
// backoff antes de desistir: no período pós-suspensão o WhatsApp derruba e
// reconecta o socket por conta própria (fora do nosso controle) com frequência
// bem maior que o normal, e uma única checagem que pega esse piscar momentâneo
// não significa que a conexão está de fato quebrada — sem isso a mensagem
// morria ali sem nunca ser tentada de novo.
async function assertEvolutionOpen(): Promise<void> {
  const provider = await getProvider()
  let lastError = "unknown"
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { state, ok, httpStatus } = await provider.getConnectionState(EVO_INSTANCE, 4_000)
    if (ok && state === "open") return
    lastError = ok ? `state=${state ?? "unknown"}` : `check falhou (${httpStatus ?? "network_error"})`
    if (attempt < 3) await sleep(800 * attempt)
  }
  throw new Error(`WhatsApp desconectado (${lastError}) — tente novamente em instantes`)
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

  // Mesmo raciocínio do check: um timeout/erro de rede pontual no meio do
  // período instável não quer dizer que a mensagem não pode ser entregue —
  // sem retry aqui, esse soluço isolado perdia o aviso pro cliente pra sempre.
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await provider.sendText(number, text, {
        quoted,
        instanceName: EVO_INSTANCE,
        timeoutMs: 9_000,
      })
      return result.raw
    } catch (e) {
      lastError = e
      if (attempt < 2) await sleep(1_500)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
