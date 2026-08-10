// Interface do adaptador de provedor de WhatsApp. Cada método aqui é um espelho
// fino da chamada HTTP que já existia direto pros arquivos de negócio — toda
// lógica de conversão jid→number, casos de @lid, grupo legado etc. continua
// nos call sites, não migra pra dentro do provider. Isso mantém a Fase 1 como
// puro refactor (zero mudança de comportamento).

export type QuotedMsg = {
  id: string
  fromMe: boolean
  remoteJid: string
  content: string
}

export type SendResult = {
  id: string | null
  raw: unknown
}

export type ConnectionState = {
  state: string | null
  ok: boolean
  httpStatus?: number
}

export type ReadReceipt = {
  id: string
  fromMe: boolean
  remoteJid: string
}

export type SendMediaOpts = {
  mediatype: "image" | "video" | "audio" | "document"
  media: string // base64 ou URL — Evolution aceita os dois no mesmo campo
  mimetype: string
  fileName: string
  caption?: string
  instanceName?: string
  timeoutMs?: number
}

export type SendTextOpts = {
  quoted?: QuotedMsg
  instanceName?: string
  timeoutMs?: number
}

export type DownloadedMedia = {
  base64: string
  mimetype: string
  extension: string
}

export type QrCodeResult = {
  base64: string | null // já com prefixo data:image/png;base64, quando presente
  state: string | null
}

export type CreateInstanceResult = {
  ok: boolean
  qrcodeBase64: string | null // já com prefixo data:image/png;base64,
}

export interface WhatsAppProvider {
  getConnectionState(instanceName?: string, timeoutMs?: number): Promise<ConnectionState>
  restartInstance(instanceName?: string): Promise<void>
  getQrCode(instanceName?: string): Promise<QrCodeResult>
  createInstance(instanceName: string, ownerNumber?: string): Promise<CreateInstanceResult>
  deleteInstance(instanceName: string): Promise<void>

  sendText(number: string, text: string, opts?: SendTextOpts): Promise<SendResult>
  sendMedia(number: string, opts: SendMediaOpts): Promise<SendResult>

  markRead(readMessages: ReadReceipt[], instanceName?: string): Promise<void>
  deleteMessage(id: string, remoteJid: string, fromMe: boolean, onlyLocally: boolean): Promise<void>
  deleteChat(remoteJid: string): Promise<void>

  findChats(body: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>[]>
  findMessages(body: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>[]>

  downloadMedia(message: unknown): Promise<DownloadedMedia | null>
}
