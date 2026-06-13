const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

export type QuotedMsg = {
  id: string
  fromMe: boolean
  remoteJid: string
  content: string
}

export async function sendWhatsApp(jid: string, text: string, quoted?: QuotedMsg) {
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) {
    throw new Error("Evolution API não configurada (vars ausentes)")
  }

  const number = jid.replace("@s.whatsapp.net", "").replace("@g.us", "")

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
