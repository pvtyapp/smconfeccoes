const EVO_URL      = (process.env.EVOLUTION_API_URL           ?? "").trim().replace(/\/+$/, "")
const EVO_KEY       = (process.env.EVOLUTION_API_KEY            ?? "").trim()
const EVO_INST_MAIN = (process.env.EVOLUTION_INSTANCE           ?? "").trim()
const EVO_INST_MKT  = (process.env.EVOLUTION_INSTANCE_MARKETING ?? "").trim()

// Erro específico de conexão caída — quem chama precisa diferenciar isso de
// um erro normal de envio (ex: número inválido), pra pausar a campanha em vez
// de só contar como "+1 erro" e seguir tentando os próximos contra um número
// já desconectado.
export class EvolutionDisconnectedError extends Error {
  constructor(state: string) {
    super(`WhatsApp desconectado (state=${state}) — envio pausado`)
    this.name = "EvolutionDisconnectedError"
  }
}

async function assertEvolutionOpen(instance: string): Promise<void> {
  const res = await fetch(`${EVO_URL}/instance/connectionState/${instance}`, {
    headers: { apikey: EVO_KEY },
    signal: AbortSignal.timeout(4_000),
  })
  if (!res.ok) throw new EvolutionDisconnectedError(`http_${res.status}`)
  const data = await res.json() as { instance?: { state?: string }; state?: string }
  const state = data?.instance?.state ?? data?.state
  if (state !== "open") {
    throw new EvolutionDisconnectedError(state ?? "unknown")
  }
}

// Sends text or image+caption to any JID (individual or group).
// Retorna o message_id real da Evolution — necessário pra gravar em wa_messages
// com o mesmo dedupe (ON CONFLICT message_id) usado pelo resto do sistema;
// sem isso, qualquer sync/reconcile recria a mesma mensagem de campanha.
//
// instance: qual número da Evolution usa pra mandar. Default é o principal
// (grupos, comportamento de sempre). Cliente individual de campanha usa o
// número isolado de marketing (EVOLUTION_INSTANCE_MARKETING) quando
// configurado — cai pro principal se ainda não tiver sido linkado, pra não
// travar o sistema no meio da migração.
export async function campaignSend(
  jid: string,
  content: string,
  mediaUrl?: string | null,
  instance: "main" | "marketing" = "main"
): Promise<string | null> {
  const EVO_INST = instance === "marketing" && EVO_INST_MKT ? EVO_INST_MKT : EVO_INST_MAIN
  await assertEvolutionOpen(EVO_INST)

  const bareNumber = jid
    .replace("@s.whatsapp.net", "")
    .replace("@g.us", "")
    .replace("@lid", "")

  // Grupo legado do WhatsApp (criado antes da mudança pro formato só-número)
  // vem como "<telefone-criador>-<timestamp>@g.us", com hífen — a Evolution só
  // resolve esse formato recebendo o JID completo, número puro sem o "@g.us"
  // ela não remonta. Confirmado batendo direto no /group/fetchAllGroups da
  // Evolution: ela mesma reporta esses grupos com esse JID, não é dado velho
  // do nosso lado. Sem esse caso, metade dos grupos configurados (os mais
  // antigos) sempre falhava silenciosamente no envio.
  const isLegacyGroupJid = jid.endsWith("@g.us") && /^\d+-\d+$/.test(bareNumber)
  const number = isLegacyGroupJid ? jid : bareNumber

  if (!isLegacyGroupJid && !/^\d+$/.test(number)) {
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
