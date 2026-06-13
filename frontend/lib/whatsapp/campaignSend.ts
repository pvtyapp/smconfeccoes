const EVO_URL  = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY  = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INST = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Sends text or image+caption to any JID (individual or group)
export async function campaignSend(
  jid: string,
  content: string,
  mediaUrl?: string | null
): Promise<void> {
  const number = jid.replace("@s.whatsapp.net", "").replace("@g.us", "")

  if (mediaUrl) {
    const r = await fetch(`${EVO_URL}/message/sendMedia/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number,
        mediatype: "image",
        media: mediaUrl,
        caption: content,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) throw new Error(`Evolution sendMedia ${r.status}`)
  } else {
    const r = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number, text: content }),
      signal: AbortSignal.timeout(9_000),
    })
    if (!r.ok) throw new Error(`Evolution sendText ${r.status}`)
  }
}
