import { getProvider } from "@/lib/whatsapp/provider"

export type DownloadedMedia = {
  base64: string
  mimeType: string
  extension: string
  filename: string
}

export type MediaCategory = "foto" | "video" | "audio" | "pix" | "dtf" | "documento" | "sticker"

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

/**
 * Downloads media from Evolution API given a full message object from the webhook.
 */
export async function downloadEvolutionMedia(message: unknown): Promise<DownloadedMedia | null> {
  try {
    // Check fileLength before downloading to avoid memory exhaustion
    const msgBody = (message as Record<string, unknown>)?.message as Record<string, unknown> | undefined
    if (msgBody) {
      const inner = (msgBody.imageMessage ?? msgBody.videoMessage ?? msgBody.audioMessage ?? msgBody.documentMessage) as Record<string, unknown> | undefined
      const fileLength = Number(inner?.fileLength ?? 0)
      if (fileLength > MAX_DOWNLOAD_BYTES) {
        console.warn("[downloadEvolutionMedia] skipping — fileLength", fileLength, "> 50 MB")
        return null
      }
    }

    const provider = await getProvider()
    const result = await provider.downloadMedia(message)
    if (!result) return null

    const mimeType  = result.mimetype
    const extension = result.extension
    const filename  = `media-${Date.now()}.${extension}`

    return { base64: result.base64, mimeType, extension, filename }
  } catch {
    return null
  }
}

/**
 * Classifies incoming media based on type, mime and current chatbot state.
 */
export function classifyMediaCategory(
  mediaType: string,
  mimeType: string,
  contactState: string
): MediaCategory {
  const mime = mimeType.toLowerCase()

  // State-based classification takes priority
  if (contactState === "aguardando_comprovante") return "pix"
  if (contactState === "aguardando_arte")         return "dtf"

  // Heuristic by mime
  if (mediaType === "audio")   return "audio"
  if (mediaType === "sticker") return "sticker"
  if (mediaType === "video")   return "video"

  if (mediaType === "image") {
    // Screenshots of PIX are JPEGs too — can't distinguish without vision AI, default to foto
    return "foto"
  }

  if (mediaType === "document") {
    // PDFs, AI, SVG, PNG, JPG sent as documents → likely DTF arte or comprovante
    if (mime.includes("pdf") || mime.includes("svg") || mime.includes("postscript"))
      return "dtf"
    if (mime.includes("image"))
      return "dtf"
    return "documento"
  }

  return "foto"
}
