import { NextResponse } from "next/server"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

function extractLastMsg(lm: Record<string, unknown>): { text: string; mediaType: string | null } {
  if (!lm) return { text: "", mediaType: null }
  const msg = lm.message as Record<string, unknown> ?? {}
  const text =
    (msg.conversation as string) ||
    ((msg.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    ""
  const mediaType =
    msg.imageMessage ? "image" :
    msg.videoMessage ? "video" :
    msg.audioMessage ? "audio" :
    msg.documentMessage ? "document" :
    msg.stickerMessage ? "sticker" : null
  return { text, mediaType }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const type  = searchParams.get("type") ?? "contacts"
  const skip  = parseInt(searchParams.get("skip")  ?? "0")
  const limit = parseInt(searchParams.get("limit") ?? "30")

  try {
    const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ skip: 0, limit: 300 }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return NextResponse.json([], { status: 200 })

    const all = await r.json()
    const items: Record<string, unknown>[] = Array.isArray(all) ? all : []

    const filtered = items.filter(c => {
      const jid = (c.remoteJid as string) ?? ""
      if (type === "groups") return jid.endsWith("@g.us")
      // contacts: skip groups, broadcast, and the instance's own number
      if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast") return false
      return true
    })

    // Sort by lastMessage timestamp DESC
    filtered.sort((a, b) => {
      const lma = a.lastMessage as Record<string, unknown> ?? {}
      const lmb = b.lastMessage as Record<string, unknown> ?? {}
      return ((lmb.messageTimestamp as number) ?? 0) - ((lma.messageTimestamp as number) ?? 0)
    })

    const page = filtered.slice(skip, skip + limit)

    const result = page.map(c => {
      const jid     = c.remoteJid as string
      const lm      = c.lastMessage as Record<string, unknown> ?? {}
      const lmKey   = lm.key as Record<string, unknown> ?? {}
      const { text, mediaType } = extractLastMsg(lm)
      const ts      = lm.messageTimestamp as number ?? 0

      return {
        jid,
        name:        (c.pushName as string) || jid,
        profilePic:  (c.profilePicUrl as string) || null,
        lastMessage: text || (mediaType ? `[${mediaType}]` : ""),
        lastAt:      ts ? new Date(ts * 1000).toISOString() : null,
        lastSender:  (lm.pushName as string) || null,
        fromMe:      Boolean(lmKey.fromMe),
        unread:      (c.unreadCount as number) ?? 0,
      }
    })

    return NextResponse.json(result)
  } catch {
    return NextResponse.json([])
  }
}
