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

/**
 * Downloads media from Evolution API given a full message object from the webhook.
 */
export async function downloadEvolutionMedia(message: unknown): Promise<DownloadedMedia | null> {
  try {
    const res = await fetch(
      `${EVO_URL}/chat/getBase64FromMediaMessage/${EVO_INSTANCE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVO_KEY },
        body: JSON.stringify({ message }),
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
 * Uploads base64 media to Vercel Blob and returns the public URL.
 */
export async function uploadToBlob(
  base64: string,
  mimeType: string,
  filename: string,
  folder: "dtf" | "pix"
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
