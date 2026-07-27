import { getProvider } from "@/lib/whatsapp/provider"

const EVO_INST_MAIN = (process.env.EVOLUTION_INSTANCE ?? "").trim()

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
  const provider = await getProvider()
  const { state, ok, httpStatus } = await provider.getConnectionState(instance, 4_000)
  if (!ok) throw new EvolutionDisconnectedError(`http_${httpStatus ?? "network_error"}`)
  if (state !== "open") {
    throw new EvolutionDisconnectedError(state ?? "unknown")
  }
}

// Sends text or image+caption to any JID (individual or group).
// Retorna o message_id real da Evolution — necessário pra gravar em wa_messages
// com o mesmo dedupe (ON CONFLICT message_id) usado pelo resto do sistema;
// sem isso, qualquer sync/reconcile recria a mesma mensagem de campanha.
//
// instanceName: qual número da Evolution usa pra mandar. null/undefined cai
// pro principal (grupo, ou cliente quando nenhum número de marketing foi
// cadastrado/conectado ainda — nunca trava o sistema por falta de config).
// Cliente individual de campanha recebe o nome do número já escolhido na
// hora da criação (pode ser 1 de N números cadastrados em marketing_instances).
export async function campaignSend(
  jid: string,
  content: string,
  mediaUrl?: string | null,
  instanceName?: string | null
): Promise<string | null> {
  const EVO_INST = instanceName || EVO_INST_MAIN
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

    const provider = await getProvider()
    try {
      const result = await provider.sendMedia(number, {
        mediatype: "image", media: mediaUrl, mimetype, fileName: rawName,
        caption: content, instanceName: EVO_INST, timeoutMs: 15_000,
      })
      return result.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[campaignSend] sendMedia falhou para ${number}:`, msg.slice(0, 300))
      throw new Error(`Evolution sendMedia: ${msg.slice(0, 120)}`)
    }
  } else {
    const provider = await getProvider()
    try {
      const result = await provider.sendText(number, content, { instanceName: EVO_INST, timeoutMs: 9_000 })
      return result.id
    } catch (e) {
      throw new Error(`Evolution sendText: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
