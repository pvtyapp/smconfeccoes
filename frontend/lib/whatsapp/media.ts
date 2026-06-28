import { put } from "@vercel/blob"

const EVO_URL      = process.env.EVOLUTION_API_URL!
const EVO_KEY      = process.env.EVOLUTION_API_KEY!
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE!

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

    const res = await fetch(
      `${EVO_URL}/chat/getBase64FromMediaMessage/${EVO_INSTANCE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(12_000),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.base64) return null

    const mimeType  = data.mimetype ?? "application/octet-stream"
    const extension = data.extension ?? mimeType.split("/")[1] ?? "bin"
    const filename  = `media-${Date.now()}.${extension}`

    return { base64: data.base64, mimeType, extension, filename }
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

/**
 * Uploads base64 media to Vercel Blob and returns the public URL.
 */
export async function uploadToBlob(
  base64: string,
  mimeType: string,
  filename: string,
  folder: "dtf" | "pix" | "media" | "audio" | "docs"
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64")
    const blob   = await put(`sm-attachments/${folder}/${filename}`, buffer, {
      access: "public",
      contentType: mimeType,
    })
    return blob.url
  } catch {
    return null
  }
}
