import type {
  WhatsAppProvider, ConnectionState, SendResult, SendMediaOpts, SendTextOpts,
  ReadReceipt, DownloadedMedia, QrCodeResult, CreateInstanceResult, GroupParticipant,
} from "./types"

// Provider da Meta Cloud API — em paralelo ao evolutionProvider.ts, ainda não
// plugado em getProvider() (index.ts continua devolvendo só o Evolution).
// Existe só pra ser testado contra o número de teste da WABA (Fase 3) antes
// do corte de verdade no +55 16 99269-2363 (Fase 4).
//
// Diferenças estruturais que não dá pra esconder atrás da mesma interface:
// - Não existe "conectar"/QR code/instância — o número é registrado direto
//   na Cloud API, não tem socket pra cair. getConnectionState checa se o
//   token+phone_number_id ainda respondem, não um estado de socket.
// - Não existe grupo (@g.us) — Cloud API não manda mensagem em grupo.
// - Não existe histórico pra puxar — findChats/findMessages sempre voltam
//   vazio, a Cloud API só entrega o que chega via webhook daqui pra frente.
// - Mensagem business-initiated fora da janela de 24h PRECISA ser template
//   aprovado — texto livre só funciona como resposta dentro da janela.

const META_TOKEN         = (process.env.META_ACCESS_TOKEN   ?? "").trim()
const META_PHONE_ID      = (process.env.META_PHONE_NUMBER_ID ?? "").trim()
const META_WABA_ID       = (process.env.META_WABA_ID         ?? "").trim()
const META_API_VERSION   = (process.env.META_API_VERSION     ?? "v25.0").trim()
const GRAPH_URL          = `https://graph.facebook.com/${META_API_VERSION}`

type GraphError = { error?: { message?: string; type?: string; code?: number; error_subcode?: number } }

async function graphFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, ...rest } = init
  const res = await fetch(`${GRAPH_URL}${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${META_TOKEN}`, ...(rest.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await res.json().catch(() => null) as (GraphError & Record<string, unknown>) | null
  if (!res.ok) {
    const msg = data?.error?.message ?? `Graph API error ${res.status}`
    throw new Error(`${msg} (code=${data?.error?.code ?? "?"}, http=${res.status})`)
  }
  return data
}

// Envia um template aprovado — usado sempre que a mensagem é proativa e pode
// cair fora da janela de 24h (kanban, lifecycle, cobrança). Fica fora do
// WhatsAppProvider porque é um conceito exclusivo da Cloud API (Evolution
// não tem templates pré-aprovados) — forçar isso no contrato comum
// obrigaria o evolutionProvider a implementar um método que não faz sentido
// pra ele.
export async function sendTemplate(
  number: string, templateName: string, languageCode: string, components?: unknown[]
): Promise<SendResult> {
  const payload = {
    messaging_product: "whatsapp",
    to: number,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  }
  const data = await graphFetch(`/${META_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }) as { messages?: { id?: string }[] }
  return { id: data?.messages?.[0]?.id ?? null, raw: data }
}

export const cloudApiProvider: WhatsAppProvider = {
  // Não tem "conexão" de verdade — confirma que o par token/phone_number_id
  // ainda é válido chamando um GET barato. "open" == responde, mais nada.
  async getConnectionState(): Promise<ConnectionState> {
    if (!META_TOKEN || !META_PHONE_ID) return { state: null, ok: false }
    try {
      await graphFetch(`/${META_PHONE_ID}?fields=id,verified_name`, { timeoutMs: 4_000 })
      return { state: "open", ok: true, httpStatus: 200 }
    } catch {
      return { state: "close", ok: false }
    }
  },

  // Não existe restart de instância na Cloud API — sem socket, sem processo
  // pra reiniciar. No-op deliberado, não é bug.
  async restartInstance(): Promise<void> {},

  // Não existe QR code — o pareamento é feito uma vez via verificação de
  // número no WhatsApp Manager (Fase 0/4), não por scan.
  async getQrCode(): Promise<QrCodeResult> {
    return { base64: null, state: null }
  },

  // Não existe "criar instância" — o ativo é o próprio phone_number_id já
  // registrado na WABA. Nada a criar por aqui.
  async createInstance(): Promise<CreateInstanceResult> {
    return { ok: false, qrcodeBase64: null }
  },

  async deleteInstance(): Promise<void> {},

  async getGroupParticipants(): Promise<GroupParticipant[]> {
    throw new Error("Cloud API não suporta grupo — recurso exclusivo do Evolution/Baileys")
  },

  async sendText(number: string, text: string, opts?: SendTextOpts): Promise<SendResult> {
    const timeoutMs = opts?.timeoutMs ?? 9_000
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: number,
      type: "text",
      text: { body: text, preview_url: false },
    }
    if (opts?.quoted) {
      payload.context = { message_id: opts.quoted.id }
    }
    const data = await graphFetch(`/${META_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs,
    }) as { messages?: { id?: string }[] }
    return { id: data?.messages?.[0]?.id ?? null, raw: data }
  },

  async sendMedia(number: string, opts: SendMediaOpts): Promise<SendResult> {
    // Cloud API só aceita mídia por link público ou por media_id já enviado
    // via /media — não aceita base64 direto no corpo, diferente do Evolution.
    // opts.media aqui precisa já ser uma URL (o call site decide isso na
    // hora do corte, não neste provider).
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: number,
      type: opts.mediatype,
      [opts.mediatype]: {
        link: opts.media,
        caption: opts.caption,
        filename: opts.mediatype === "document" ? opts.fileName : undefined,
      },
    }
    const data = await graphFetch(`/${META_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: opts.timeoutMs ?? 12_000,
    }) as { messages?: { id?: string }[] }
    return { id: data?.messages?.[0]?.id ?? null, raw: data }
  },

  async markRead(readMessages: ReadReceipt[]): Promise<void> {
    // Cloud API marca como lido um de cada vez, por message_id — sem batch.
    for (const r of readMessages) {
      await graphFetch(`/${META_PHONE_ID}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: r.id }),
        timeoutMs: 5_000,
      }).catch(() => {})
    }
  },

  // Cloud API não tem "apagar mensagem pro destinatário" nem "apagar
  // conversa" — isso só existe no WhatsApp Web automatizado (Baileys).
  async deleteMessage(): Promise<void> {
    throw new Error("Cloud API não suporta apagar mensagem — recurso exclusivo do Evolution/Baileys")
  },
  async deleteChat(): Promise<void> {
    throw new Error("Cloud API não suporta apagar conversa — recurso exclusivo do Evolution/Baileys")
  },

  // Sem histórico pra puxar — a Cloud API não tem endpoint de "listar
  // conversas/mensagens antigas". Tudo que existe daqui pra frente chega
  // via webhook e já fica salvo no nosso banco; não tem o que sincronizar
  // retroativamente como o Evolution faz.
  async findChats(): Promise<Record<string, unknown>[]> { return [] },
  async findMessages(): Promise<Record<string, unknown>[]> { return [] },

  async downloadMedia(message: unknown): Promise<DownloadedMedia | null> {
    const mediaId = (message as { id?: string } | null)?.id
    if (!mediaId) return null
    try {
      const meta = await graphFetch(`/${mediaId}`, { timeoutMs: 8_000 }) as { url?: string; mime_type?: string }
      if (!meta?.url) return null
      const res = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${META_TOKEN}` },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      const mimetype = meta.mime_type ?? "application/octet-stream"
      const extension = mimetype.split("/")[1] ?? "bin"
      return { base64: buf.toString("base64"), mimetype, extension }
    } catch {
      return null
    }
  },
}
