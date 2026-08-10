import type {
  WhatsAppProvider, ConnectionState, SendResult, SendMediaOpts, SendTextOpts,
  ReadReceipt, DownloadedMedia, QrCodeResult, CreateInstanceResult,
} from "./types"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Mesma normalização de shape de resposta que já estava duplicada idêntica em
// syncMessages.ts, webhook/route.ts, sync/route.ts, thread/route.ts,
// sync-outgoing/route.ts, group-messages/route.ts e chats/route.ts.
function normalizeRecords(data: unknown): Record<string, unknown>[] {
  const d = data as Record<string, unknown> | null | undefined
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[]
  if (Array.isArray(d?.messages && (d.messages as Record<string, unknown>).records))
    return (d!.messages as Record<string, unknown>).records as Record<string, unknown>[]
  if (Array.isArray(d?.records)) return d!.records as Record<string, unknown>[]
  if (Array.isArray(d?.data)) return d!.data as Record<string, unknown>[]
  if (Array.isArray(d?.messages)) return d!.messages as Record<string, unknown>[]
  if (Array.isArray(d?.chats)) return d!.chats as Record<string, unknown>[]
  return []
}

export const evolutionProvider: WhatsAppProvider = {
  async getConnectionState(instanceName, timeoutMs = 4_000): Promise<ConnectionState> {
    const instance = instanceName || EVO_INSTANCE
    if (!EVO_URL || !EVO_KEY || !instance) return { state: null, ok: false }
    try {
      const res = await fetch(`${EVO_URL}/instance/connectionState/${instance}`, {
        headers: { apikey: EVO_KEY },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return { state: null, ok: false, httpStatus: res.status }
      const data = await res.json() as { instance?: { state?: string }; state?: string }
      const state = data?.instance?.state ?? data?.state ?? null
      return { state, ok: true, httpStatus: res.status }
    } catch {
      return { state: null, ok: false }
    }
  },

  async restartInstance(instanceName): Promise<void> {
    const instance = instanceName || EVO_INSTANCE
    await fetch(`${EVO_URL}/instance/restart/${instance}`, {
      method: "PUT",
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(10_000),
    })
  },

  async getQrCode(instanceName): Promise<QrCodeResult> {
    const instance = instanceName || EVO_INSTANCE
    try {
      const res = await fetch(`${EVO_URL}/instance/connect/${instance}`, {
        headers: { apikey: EVO_KEY },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { base64: null, state: null }
      const data = await res.json() as { base64?: string; qrcode?: string | { base64?: string }; instance?: { state?: string }; state?: string }
      const raw = data.base64 ?? (typeof data.qrcode === "string" ? data.qrcode : data.qrcode?.base64) ?? null
      const base64 = raw ? (raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : null
      const state = data.instance?.state ?? data.state ?? null
      return { base64, state }
    } catch {
      return { base64: null, state: null }
    }
  },

  async createInstance(instanceName: string, ownerNumber?: string): Promise<CreateInstanceResult> {
    try {
      const res = await fetch(`${EVO_URL}/instance/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({
          instanceName,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          ...(ownerNumber ? { number: ownerNumber } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { ok: false, qrcodeBase64: null }
      const data = await res.json() as { qrcode?: { base64?: string } }
      const raw = data.qrcode?.base64 ?? null
      return { ok: true, qrcodeBase64: raw ? (raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : null }
    } catch {
      return { ok: false, qrcodeBase64: null }
    }
  },

  async deleteInstance(instanceName: string): Promise<void> {
    await fetch(`${EVO_URL}/instance/delete/${instanceName}`, {
      method: "DELETE",
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {})
  },

  async sendText(number: string, text: string, opts?: SendTextOpts): Promise<SendResult> {
    const instance = opts?.instanceName || EVO_INSTANCE
    const timeoutMs = opts?.timeoutMs ?? 9_000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)

    const payload: Record<string, unknown> = { number, text }
    if (opts?.quoted) {
      payload.quoted = {
        key: { id: opts.quoted.id, fromMe: opts.quoted.fromMe, remoteJid: opts.quoted.remoteJid },
        message: { conversation: opts.quoted.content },
      }
    }

    try {
      const res = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Evolution API error ${res.status}: ${err}`)
      }
      const raw = await res.json() as { key?: { id?: string } }
      return { id: raw?.key?.id ?? null, raw }
    } finally {
      clearTimeout(timer)
    }
  },

  async sendMedia(number: string, opts: SendMediaOpts): Promise<SendResult> {
    const instance = opts.instanceName || EVO_INSTANCE
    const timeoutMs = opts.timeoutMs ?? 12_000
    const endpoint = opts.mediatype === "document"
      ? `${EVO_URL}/message/sendDocument/${instance}`
      : `${EVO_URL}/message/sendMedia/${instance}`

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number,
        mediatype: opts.mediatype,
        mimetype: opts.mimetype,
        caption: opts.caption ?? "",
        media: opts.media,
        fileName: opts.fileName,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      throw new Error(`Evolution sendMedia ${res.status}: ${errBody.slice(0, 300)}`)
    }
    const raw = await res.json().catch(() => null) as { key?: { id?: string } } | null
    return { id: raw?.key?.id ?? null, raw }
  },

  async markRead(readMessages: ReadReceipt[], instanceName): Promise<void> {
    const instance = instanceName || EVO_INSTANCE
    await fetch(`${EVO_URL}/message/markAsRead/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        readMessages: readMessages.map(r => ({
          key: { id: r.id, fromMe: r.fromMe, remoteJid: r.remoteJid },
        })),
      }),
      signal: AbortSignal.timeout(5_000),
    })
  },

  async deleteMessage(id: string, remoteJid: string, fromMe: boolean, onlyLocally: boolean): Promise<void> {
    await fetch(`${EVO_URL}/message/delete/${EVO_INSTANCE}?onlyLocally=${onlyLocally}`, {
      method: "DELETE",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ id, remoteJid, fromMe }),
    })
  },

  async deleteChat(remoteJid: string): Promise<void> {
    await fetch(`${EVO_URL}/chat/delete/${EVO_INSTANCE}`, {
      method: "DELETE",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ remoteJid }),
    })
  },

  async findChats(body: Record<string, unknown>, timeoutMs = 8_000): Promise<Record<string, unknown>[]> {
    try {
      const res = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return []
      return normalizeRecords(await res.json())
    } catch {
      return []
    }
  },

  async findMessages(body: Record<string, unknown>, timeoutMs = 8_000): Promise<Record<string, unknown>[]> {
    try {
      const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return []
      return normalizeRecords(await res.json())
    } catch {
      return []
    }
  },

  async downloadMedia(message: unknown): Promise<DownloadedMedia | null> {
    try {
      const res = await fetch(`${EVO_URL}/chat/getBase64FromMediaMessage/${EVO_INSTANCE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.base64) return null
      const mimetype  = data.mimetype ?? "application/octet-stream"
      const extension = data.extension ?? mimetype.split("/")[1] ?? "bin"
      return { base64: data.base64, mimetype, extension }
    } catch {
      return null
    }
  },
}
