import type {
  WhatsAppProvider, ConnectionState, SendResult, SendMediaOpts, SendTextOpts,
  ReadReceipt, DownloadedMedia, QrCodeResult, CreateInstanceResult,
} from "./types"

// Diferente da Evolution (1 servidor gerencia N "instâncias"), aqui é 1 servidor
// gerencia N "sessões" — mesmo conceito, nome diferente. WPPCONNECT_SESSION_NAME
// é a sessão padrão (a "principal"); outras sessões (marketing) são passadas via
// instanceName nos métodos que aceitam.
const WPP_URL     = (process.env.WPPCONNECT_API_URL     ?? "").trim().replace(/\/+$/, "")
const WPP_SECRET  = (process.env.WPPCONNECT_SECRET_KEY  ?? "").trim()
const WPP_SESSION = (process.env.WPPCONNECT_SESSION_NAME ?? "").trim()

// Token por sessão, cacheado em memória — gerado via secretKey, expira e é
// regenerado sob demanda (retry automático em 401), mesmo padrão do PVTY.
const tokenCache = new Map<string, string>()

async function getToken(session: string): Promise<string> {
  const cached = tokenCache.get(session)
  if (cached) return cached
  const res = await fetch(`${WPP_URL}/api/${session}/${WPP_SECRET}/generate-token`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`WPPConnect generate-token falhou (${res.status})`)
  const data = await res.json() as { token?: string; full?: string }
  const token = data.token ?? data.full
  if (!token) throw new Error("WPPConnect generate-token não devolveu token")
  tokenCache.set(session, token)
  return token
}

async function wppFetch(session: string, path: string, init: RequestInit & { timeoutMs?: number } = {}, retry = true): Promise<Response> {
  const token = await getToken(session)
  const { timeoutMs = 10_000, ...rest } = init
  const res = await fetch(`${WPP_URL}/api/${session}${path}`, {
    ...rest,
    headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 && retry) {
    tokenCache.delete(session)
    return wppFetch(session, path, init, false)
  }
  return res
}

// Converte o "number" que os call sites hoje montam pensando na Evolution
// (às vezes bare digits, às vezes jid completo com @lid/@g.us) pro formato
// que o WPPConnect espera: telefone puro + flags isGroup/isLid.
// Grupo comum (sem hífen) já chega sem sufixo pelos call sites atuais — a
// granularidade fina de grupo fica pra Fase 5, aqui é best-effort.
function parseTarget(numberOrJid: string): { phone: string; isGroup: boolean; isLid: boolean } {
  if (numberOrJid.endsWith("@lid")) {
    return { phone: numberOrJid.replace("@lid", ""), isGroup: false, isLid: true }
  }
  if (numberOrJid.endsWith("@g.us")) {
    return { phone: numberOrJid.replace("@g.us", ""), isGroup: true, isLid: false }
  }
  return { phone: numberOrJid.replace("@s.whatsapp.net", ""), isGroup: false, isLid: false }
}

function extractMessageId(raw: unknown): string | null {
  const first = Array.isArray((raw as { response?: unknown[] })?.response)
    ? (raw as { response: unknown[] }).response[0] as Record<string, unknown> | undefined
    : undefined
  if (!first) return null
  const id = first.id as unknown
  if (typeof id === "string") return id
  if (id && typeof id === "object" && "_serialized" in (id as Record<string, unknown>)) {
    return (id as Record<string, unknown>)._serialized as string
  }
  return null
}

export const wppconnectProvider: WhatsAppProvider = {
  async getConnectionState(instanceName, timeoutMs = 6_000): Promise<ConnectionState> {
    const session = instanceName || WPP_SESSION
    try {
      const res = await wppFetch(session, "/check-connection-session", { timeoutMs })
      if (!res.ok) return { state: null, ok: false, httpStatus: res.status }
      const data = await res.json() as { status?: boolean }
      return { state: data.status ? "open" : "close", ok: true, httpStatus: res.status }
    } catch {
      return { state: null, ok: false }
    }
  },

  // Não existe restart de verdade na API (o endpoint oficial é um stub "Not
  // implemented yet") — fecha e reabre a sessão manualmente no lugar.
  async restartInstance(instanceName): Promise<void> {
    const session = instanceName || WPP_SESSION
    await wppFetch(session, "/close-session", { method: "POST", timeoutMs: 10_000 }).catch(() => {})
    await wppFetch(session, "/start-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waitQrCode: false }),
      timeoutMs: 10_000,
    })
  },

  async getQrCode(instanceName): Promise<QrCodeResult> {
    const session = instanceName || WPP_SESSION
    try {
      const res = await wppFetch(session, "/status-session", { timeoutMs: 10_000 })
      if (!res.ok) return { base64: null, state: null }
      const data = await res.json() as { status?: string; qrcode?: string | null }
      return { base64: data.qrcode ?? null, state: data.status ?? null }
    } catch {
      return { base64: null, state: null }
    }
  },

  // "Criar instância" aqui é "iniciar a sessão" — WPPConnect não tem um passo
  // de criação separado, o nome na URL já é a identidade. waitQrCode:false pra
  // não travar a resposta; o QR sai no próximo poll de getQrCode (mesmo padrão
  // que o QrModal do dashboard já faz a cada 4s).
  async createInstance(instanceName: string): Promise<CreateInstanceResult> {
    try {
      const res = await wppFetch(instanceName, "/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitQrCode: false }),
        timeoutMs: 15_000,
      })
      if (!res.ok) return { ok: false, qrcodeBase64: null }
      // Dá um instante pro puppeteer subir e gerar o urlcode antes do 1º poll.
      await new Promise(r => setTimeout(r, 2_000))
      const status = await wppconnectProvider.getQrCode(instanceName)
      return { ok: true, qrcodeBase64: status.base64 }
    } catch {
      return { ok: false, qrcodeBase64: null }
    }
  },

  async sendText(number: string, text: string, opts?: SendTextOpts): Promise<SendResult> {
    const session = opts?.instanceName || WPP_SESSION
    const { phone, isGroup, isLid } = parseTarget(number)
    const res = await wppFetch(session, "/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: [phone],
        message: text,
        isGroup, isLid,
        ...(opts?.quoted ? { options: { quotedMsg: opts.quoted.id } } : {}),
      }),
      timeoutMs: opts?.timeoutMs ?? 9_000,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => "")
      throw new Error(`WPPConnect send-message ${res.status}: ${err.slice(0, 300)}`)
    }
    const raw = await res.json()
    return { id: extractMessageId(raw), raw }
  },

  async sendMedia(number: string, opts: SendMediaOpts): Promise<SendResult> {
    const session = opts.instanceName || WPP_SESSION
    const { phone, isGroup, isLid } = parseTarget(number)
    const dataUrl = opts.media.startsWith("data:") ? opts.media : `data:${opts.mimetype};base64,${opts.media}`
    const res = await wppFetch(session, "/send-file-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: [phone],
        base64: dataUrl,
        filename: opts.fileName,
        caption: opts.caption ?? "",
        isGroup, isLid,
      }),
      timeoutMs: opts.timeoutMs ?? 15_000,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => "")
      throw new Error(`WPPConnect send-file ${res.status}: ${err.slice(0, 300)}`)
    }
    const raw = await res.json()
    return { id: extractMessageId(raw), raw }
  },

  // sendSeen do WPPConnect marca a CONVERSA inteira como lida, não mensagem a
  // mensagem como o markAsRead da Evolution — os call sites de hoje sempre
  // mandam um lote do mesmo remoteJid de uma vez, então 1 chamada já cobre.
  async markRead(readMessages: ReadReceipt[], instanceName): Promise<void> {
    if (readMessages.length === 0) return
    const session = instanceName || WPP_SESSION
    const uniqueJids = [...new Set(readMessages.map(r => r.remoteJid))]
    for (const jid of uniqueJids) {
      const { phone, isGroup } = parseTarget(jid)
      await wppFetch(session, "/send-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: [phone], isGroup }),
        timeoutMs: 5_000,
      }).catch(() => {})
    }
  },

  async deleteMessage(id: string, remoteJid: string, fromMe: boolean, onlyLocally: boolean): Promise<void> {
    const { phone, isGroup } = parseTarget(remoteJid)
    await wppFetch(WPP_SESSION, "/delete-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, isGroup, messageId: id, onlyLocal: onlyLocally, deleteMediaInDevice: true }),
    }).catch(() => {})
  },

  async deleteChat(remoteJid: string): Promise<void> {
    const { phone, isGroup } = parseTarget(remoteJid)
    await wppFetch(WPP_SESSION, "/delete-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: [phone], isGroup }),
    }).catch(() => {})
  },

  // Retorna o array de chats no formato NATIVO do WPPConnect (bem diferente
  // do formato Baileys/Evolution) — quem consome isso hoje (webhook, sync,
  // etc.) foi escrito pensando no shape da Evolution. Reescrever esses
  // consumidores é a Fase 3/4, não este método — aqui só a chamada de API
  // fica correta.
  async findChats(body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const count = typeof body.limit === "number" ? body.limit : 300
    try {
      const res = await wppFetch(WPP_SESSION, "/list-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
        timeoutMs: 12_000,
      })
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  },

  // Mesma ressalva do findChats — shape nativo WPPConnect, não Baileys.
  async findMessages(body: Record<string, unknown>, timeoutMs = 8_000): Promise<Record<string, unknown>[]> {
    const where = body.where as { key?: { remoteJid?: string } } | undefined
    const remoteJid = where?.key?.remoteJid
    if (!remoteJid) return []
    const { phone } = parseTarget(remoteJid)
    const count = typeof body.limit === "number" ? body.limit : 20
    try {
      const res = await wppFetch(WPP_SESSION, `/get-messages/${encodeURIComponent(phone)}?count=${count}`, { timeoutMs })
      if (!res.ok) return []
      const data = await res.json() as { response?: unknown[] }
      return Array.isArray(data.response) ? data.response as Record<string, unknown>[] : []
    } catch {
      return []
    }
  },

  async downloadMedia(message: unknown): Promise<DownloadedMedia | null> {
    const messageId = (message as Record<string, unknown>)?.id
    const idStr = typeof messageId === "string" ? messageId
      : (messageId && typeof messageId === "object" && "_serialized" in (messageId as Record<string, unknown>))
        ? (messageId as Record<string, unknown>)._serialized as string
        : null
    if (!idStr) return null
    try {
      const res = await wppFetch(WPP_SESSION, `/get-media-by-message/${encodeURIComponent(idStr)}`, { timeoutMs: 45_000 })
      if (!res.ok) return null
      const data = await res.json() as { base64?: string; mimetype?: string }
      if (!data.base64) return null
      const mimetype = data.mimetype ?? "application/octet-stream"
      const extension = mimetype.split("/")[1] ?? "bin"
      return { base64: data.base64, mimetype, extension }
    } catch {
      return null
    }
  },
}
