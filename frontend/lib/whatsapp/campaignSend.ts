const EVO_URL  = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY  = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INST = (process.env.EVOLUTION_INSTANCE ?? "").trim()

async function assertEvolutionOpen(): Promise<void> {
  const res = await fetch(`${EVO_URL}/instance/connectionState/${EVO_INST}`, {
    headers: { apikey: EVO_KEY },
    signal: AbortSignal.timeout(4_000),
  })
  if (!res.ok) throw new Error(`Evolution status check falhou (${res.status})`)
  const data = await res.json() as { instance?: { state?: string }; state?: string }
  const state = data?.instance?.state ?? data?.state
  if (state !== "open") {
    throw new Error(`WhatsApp desconectado (state=${state ?? "unknown"}) — campanha pausada`)
  }
}

// Sends text or image+caption to any JID (individual or group).
// Retorna o message_id real da Evolution — necessário pra gravar em wa_messages
// com o mesmo dedupe (ON CONFLICT message_id) usado pelo resto do sistema;
// sem isso, qualquer sync/reconcile recria a mesma mensagem de campanha.
export async function campaignSend(
  jid: string,
  content: string,
  mediaUrl?: string | null
): Promise<string | null> {
  await assertEvolutionOpen()

  const number = jid
    .replace("@s.whatsapp.net", "")
    .replace("@g.us", "")
    .replace("@lid", "")

  if (!/^\d+$/.test(number)) {
    throw new Error(`JID inválido para envio: ${jid}`)
  }

  if (mediaUrl) {
    // Derive fileName + mimetype from URL so Evolution can infer the media type correctly
    const rawName = mediaUrl.split("/").pop()?.split("?")[0] ?? "image.jpg"
    const ext = rawName.split(".").pop()?.toLowerCase() ?? "jpg"
    const MIME: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg",
      png: "image/png",  gif: "image/gif",  webp: "image/webp",
    }
    const mimetype = MIME[ext] ?? "image/jpeg"

    const r = await fetch(`${EVO_URL}/message/sendMedia/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number,
        mediatype: "image",
        media: mediaUrl,
        caption: content,
        mimetype,
        fileName: rawName,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
      const errBody = await r.text().catch(() => "")
      console.error(`[campaignSend] sendMedia falhou ${r.status} para ${number}:`, errBody.slice(0, 300))
      throw new Error(`Evolution sendMedia ${r.status}: ${errBody.slice(0, 120)}`)
    }
    const data = await r.json().catch(() => null) as { key?: { id?: string } } | null
    return data?.key?.id ?? null
  } else {
    const r = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number, text: content }),
      signal: AbortSignal.timeout(9_000),
    })
    if (!r.ok) throw new Error(`Evolution sendText ${r.status}`)
    const data = await r.json().catch(() => null) as { key?: { id?: string } } | null
    return data?.key?.id ?? null
  }
}
