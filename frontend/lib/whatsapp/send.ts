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
  const res = await fetch(`${EVO_URL}/instance/connectionState/${EVO_INSTANCE}`, {
    headers: { apikey: EVO_KEY },
    signal: AbortSignal.timeout(4_000),
  })
  if (!res.ok) throw new Error(`Evolution status check falhou (${res.status})`)
  const data = await res.json() as { instance?: { state?: string }; state?: string }
  const state = data?.instance?.state ?? data?.state
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

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9_000)

  const payload: Record<string, unknown> = { number, text }
  if (quoted) {
    payload.quoted = {
      key: { id: quoted.id, fromMe: quoted.fromMe, remoteJid: quoted.remoteJid },
      message: { conversation: quoted.content },
    }
  }

  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVO_KEY,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Evolution API error ${res.status}: ${err}`)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}
