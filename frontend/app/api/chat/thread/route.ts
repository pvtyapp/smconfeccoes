import { NextResponse } from "next/server"
import { getProvider } from "@/lib/whatsapp/provider"

interface MediaInfo {
  mediaType: string | null
  thumbnail: string | null  // base64 jpeg thumbnail (direct from WhatsApp message)
  caption: string | null
  fileName: string | null
}

// Evolution sends jpegThumbnail as Buffer {"0":255,"1":216,...} — convert to base64
function bufferToBase64(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === "string") return raw
  if (typeof raw === "object") {
    try {
      const vals = Object.values(raw as Record<string, number>)
      if (vals.length && typeof vals[0] === "number")
        return Buffer.from(new Uint8Array(vals)).toString("base64")
    } catch { return null }
  }
  return null
}

function extractContent(msg: Record<string, unknown>): { text: string } & MediaInfo {
  if (!msg) return { text: "", mediaType: null, thumbnail: null, caption: null, fileName: null }

  const text =
    (msg.conversation as string) ||
    ((msg.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    ""

  if (msg.imageMessage) {
    const m = msg.imageMessage as Record<string, unknown>
    return { text, mediaType: "image", thumbnail: bufferToBase64(m.jpegThumbnail), caption: (m.caption as string) ?? null, fileName: null }
  }
  if (msg.videoMessage) {
    const m = msg.videoMessage as Record<string, unknown>
    return { text, mediaType: "video", thumbnail: bufferToBase64(m.jpegThumbnail), caption: (m.caption as string) ?? null, fileName: null }
  }
  if (msg.audioMessage) {
    return { text, mediaType: "audio", thumbnail: null, caption: null, fileName: null }
  }
  if (msg.documentMessage) {
    const m = msg.documentMessage as Record<string, unknown>
    return { text, mediaType: "document", thumbnail: null, caption: null, fileName: (m.fileName as string) ?? null }
  }
  if (msg.stickerMessage) {
    const m = msg.stickerMessage as Record<string, unknown>
    return { text, mediaType: "sticker", thumbnail: bufferToBase64(m.jpegThumbnail), caption: null, fileName: null }
  }

  return { text, mediaType: null, thumbnail: null, caption: null, fileName: null }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const jid   = searchParams.get("jid")   ?? ""
  const skip  = parseInt(searchParams.get("skip")  ?? "0")
  const limit = parseInt(searchParams.get("limit") ?? "300")

  if (!jid) return NextResponse.json({ error: "jid obrigatório" }, { status: 400 })

  try {
    const provider = await getProvider()
    const raw = await provider.findMessages({ where: { key: { remoteJid: jid } }, skip, limit }, 15_000)

    // Filter out system messages with no useful content
    const filtered = raw.filter(m => {
      const msg  = m.message as Record<string, unknown> ?? {}
      const { text, mediaType } = extractContent(msg)
      return text || mediaType
    })

    // Sort ASC (oldest → newest) for display
    filtered.sort((a, b) =>
      ((a.messageTimestamp as number) ?? 0) - ((b.messageTimestamp as number) ?? 0)
    )

    const messages = filtered.map(m => {
      const key  = m.key as Record<string, unknown> ?? {}
      const msg  = m.message as Record<string, unknown> ?? {}
      const { text, mediaType, thumbnail, caption, fileName } = extractContent(msg)

      const participantLid = key.participant as string | undefined
      const participantAlt = key.participantAlt as string | undefined
      const senderJid =
        participantAlt ||
        (participantLid && !participantLid.endsWith("@lid") ? participantLid : undefined) ||
        ""

      return {
        id:          key.id as string || String(m.messageTimestamp),
        fromMe:      Boolean(key.fromMe),
        senderJid,
        senderName:  (m.pushName as string) || "",
        content:     text || caption || fileName || `[${mediaType}]`,
        mediaType,
        thumbnail,   // base64 jpeg — use as: data:image/jpeg;base64,{thumbnail}
        caption,
        fileName,
        createdAt:   m.messageTimestamp
          ? new Date((m.messageTimestamp as number) * 1000).toISOString()
          : new Date().toISOString(),
        status:      (m.status as string) || null,
      }
    })

    return NextResponse.json({
      messages,
      hasMore: raw.length === limit,
      skip,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
