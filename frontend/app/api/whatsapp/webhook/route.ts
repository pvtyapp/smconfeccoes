import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { classifyAndParse } from "@/lib/ai/classifyAndParse"
import { downloadEvolutionMedia, classifyMediaCategory, type MediaCategory } from "@/lib/whatsapp/media"
import { matchVariants } from "@/lib/whatsapp/matchVariant"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { todayBR } from "@/lib/tz"
import { sortSizes } from "@/lib/sizeOrder"
import { resolveAdminUser, handleAdminMessage } from "@/lib/whatsapp/adminBot"
import { findOrCreateOperatorContact } from "@/lib/whatsapp/resolveOperatorContact"
import { getProvider } from "@/lib/whatsapp/provider"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Dá tempo pro download de mídia grande (waitUntil) terminar em segundo plano
// sem o Vercel matar a função antes da hora.
export const maxDuration = 60

// Contato @lid cuja 1ª mensagem não trouxe remoteJidAlt fica com phone_jid NULL e o
// campo "phone" com o hash interno do @lid (parece telefone, não é). Antes disso só era
// corrigido pelo cron diário (/api/chat/sync, 09h BRT). Aqui tentamos resolver na hora,
// consultando a mesma lista de chats que o sync usa — throttle de 10min por contato pra
// não bater na Evolution a cada mensagem de quem ainda não resolveu.
async function resolveLidPhoneInBackground(jid: string, contactId: number): Promise<void> {
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) return
  try {
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS phone_jid_synced_at TIMESTAMPTZ`).catch(() => {})

    const { rows } = await pool.query(
      `SELECT phone_jid AS "phoneJid", phone_jid_synced_at AS "syncedAt" FROM wa_contacts WHERE id = $1`,
      [contactId]
    )
    const row = rows[0] as { phoneJid: string | null; syncedAt: Date | null } | undefined
    if (!row || row.phoneJid) return
    if (row.syncedAt && Date.now() - new Date(row.syncedAt).getTime() < 10 * 60 * 1000) return

    await pool.query(`UPDATE wa_contacts SET phone_jid_synced_at = NOW() WHERE id = $1`, [contactId]).catch(() => {})

    const provider = await getProvider()
    const chats = await provider.findChats({ skip: 0, limit: 500 }, 8_000)

    const match  = chats.find(c => ((c.remoteJid ?? c.id) as string) === jid)
    const lastMsg = match?.lastMessage as Record<string, unknown> | undefined
    const lastKey = lastMsg?.key as Record<string, unknown> | undefined
    const alt: string = (lastKey?.remoteJidAlt as string) || ""
    if (!alt.endsWith("@s.whatsapp.net")) return

    const realPhone = alt.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    await pool.query(
      `UPDATE wa_contacts SET phone_jid = $1, phone = $2, updated_at = NOW() WHERE id = $3 AND phone_jid IS NULL`,
      [alt, realPhone, contactId]
    ).catch(() => {})
  } catch { /* best-effort — próxima tentativa na mensagem seguinte ou no cron diário */ }
}

function cleanPushName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === "você" || lower === "voce") return null
  if (/^\d+$/.test(trimmed)) return null
  return trimmed
}

// Cria/atualiza o contato a partir de uma mensagem recebida. Usado tanto pela mensagem
// principal quanto pelas mensagens extras de um lote (Evolution agrupa várias no mesmo
// webhook) — antes eram 2 implementações divergentes, uma delas nunca salvava nome nem
// tentava resolver telefone @lid.
async function upsertContactFromMessage(jid: string, rawPushName: string, remoteJidAlt: string) {
  const phoneJid: string | null = jid.endsWith("@lid") && remoteJidAlt.endsWith("@s.whatsapp.net") ? remoteJidAlt : null
  const phone = phoneJid
    ? phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    : jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  const pushName = cleanPushName(rawPushName)

  // @s.whatsapp.net mas já existe @lid gêmeo pro mesmo número — funde nele em vez de
  // criar um contato separado. Corrige phone/phone_jid e (diferente de antes) o nome.
  if (jid.endsWith("@s.whatsapp.net") && phone.length >= 8) {
    const { rows } = await pool.query(`
      SELECT id, state, state_data AS "stateData", lifecycle_state AS "lifecycleState",
             updated_at AS "updatedAt", last_order_at AS "lastOrderAt"
      FROM wa_contacts WHERE jid LIKE '%@lid' AND (phone = $1 OR phone_jid = $2) LIMIT 1
    `, [phone, jid]).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    if (rows[0]) {
      await pool.query(`
        UPDATE wa_contacts SET
          phone_jid = COALESCE(phone_jid, $1),
          phone     = CASE WHEN phone ~ '^[0-9]{8,15}$' THEN phone ELSE $2 END,
          name      = CASE WHEN name IS NOT NULL THEN name
                           WHEN $4::text IS NULL THEN name
                           ELSE $4 END,
          updated_at = NOW()
        WHERE id = $3
      `, [jid, phone, rows[0].id, pushName]).catch(() => {})
      return rows[0]
    }
  }

  // @lid mas já existe um contato com telefone batendo (jid @s.whatsapp.net antigo,
  // ou phone_jid já resolvido de uma conversa anterior) — reaproveita esse contato e
  // atualiza o jid pro @lid atual, em vez de criar um segundo contato. Sem isso, toda
  // vez que o WhatsApp troca o endereçamento desse número, a mensagem seguinte cai
  // num contato novo (ou pior, num jid que não bate com nada e o INSERT some sem
  // fundir com o histórico existente).
  if (jid.endsWith("@lid") && phoneJid && phone.length >= 8) {
    const { rows } = await pool.query(`
      SELECT id, state, state_data AS "stateData", lifecycle_state AS "lifecycleState",
             updated_at AS "updatedAt", last_order_at AS "lastOrderAt"
      FROM wa_contacts WHERE jid != $3 AND (phone = $1 OR phone_jid = $2) LIMIT 1
    `, [phone, phoneJid, jid]).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    if (rows[0]) {
      await pool.query(`
        UPDATE wa_contacts SET
          jid       = $1,
          phone_jid = COALESCE(phone_jid, $2),
          name      = CASE WHEN name IS NOT NULL THEN name
                           WHEN $4::text IS NULL THEN name
                           ELSE $4 END,
          updated_at = NOW()
        WHERE id = $3
      `, [jid, phoneJid, rows[0].id, pushName]).catch(() => {})
      return rows[0]
    }
  }

  const { rows } = await pool.query(`
    INSERT INTO wa_contacts (jid, name, phone, phone_jid)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (jid) DO UPDATE SET
      name      = CASE
                    WHEN wa_contacts.name IS NOT NULL THEN wa_contacts.name
                    WHEN EXCLUDED.name IS NULL OR EXCLUDED.name ~ '^[0-9]+$' OR EXCLUDED.name = '' THEN NULL
                    ELSE EXCLUDED.name
                  END,
      phone     = CASE WHEN EXCLUDED.phone ~ '^[0-9]{8,15}$' THEN EXCLUDED.phone ELSE wa_contacts.phone END,
      phone_jid = COALESCE(EXCLUDED.phone_jid, wa_contacts.phone_jid),
      updated_at = NOW()
    RETURNING id, state, state_data AS "stateData", lifecycle_state AS "lifecycleState",
              updated_at AS "updatedAt", last_order_at AS "lastOrderAt"
  `, [jid, pushName, phone, phoneJid])

  const contact = rows[0]
  if (jid.endsWith("@lid") && !phoneJid) waitUntil(resolveLidPhoneInBackground(jid, contact.id as number))
  return contact
}

// Mensagem enviada do próprio celular/WA Desktop (fromMe) — salva no histórico da
// conversa. Extraído do laço principal pra rodar igual em toda mensagem de um lote,
// não só na primeira (antes, se viesse como 2ª+ mensagem do lote, era ignorada).
async function handleFromMeMessage(msg: Record<string, unknown>, jid: string, key: Record<string, unknown>): Promise<void> {
  try {
    const msgBody0 = msg.message as Record<string, unknown> | undefined
    let text0: string =
      (msgBody0?.conversation as string) ||
      ((msgBody0?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
      ""
    let outMediaType: string | null = null
    let outFileName: string | null  = null
    if (!text0 && msgBody0) {
      if (msgBody0.imageMessage) {
        text0 = "[📸 imagem]"; outMediaType = "image"
      } else if (msgBody0.audioMessage) {
        text0 = "[🎤 áudio]"; outMediaType = "audio"
      } else if (msgBody0.videoMessage) {
        const cap = (msgBody0.videoMessage as Record<string, unknown>)?.caption as string
        text0 = cap ? `[🎥 vídeo] ${cap}` : "[🎥 vídeo]"; outMediaType = "video"
      } else if (msgBody0.documentMessage) {
        const d = msgBody0.documentMessage as Record<string, unknown>
        outFileName = (d.fileName as string) ?? null
        text0 = outFileName || "[📄 documento]"; outMediaType = "document"
      } else if (msgBody0.stickerMessage) {
        text0 = "[🎨 sticker]"; outMediaType = "sticker"
      }
    }
    if (!text0) return

    const remoteJidAlt = (key?.remoteJidAlt as string) || ""
    const phoneJid: string | null = jid.endsWith("@lid") && remoteJidAlt.endsWith("@s.whatsapp.net") ? remoteJidAlt : null
    const outMsgId: string | null = (key?.id as string) ?? null
    const ts = key?.timestamp ? new Date(Number(key.timestamp) * 1000) : null
    const outPhone = phoneJid
      ? phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      : jid.endsWith("@lid")
        ? jid.replace(/@lid$/, "").replace(/:[0-9]+$/, "").replace(/\D/g, "")
        : jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    // Lookup by phone OR phone_jid — prevents ghost @s.whatsapp.net when @lid has garbage phone field
    const sendJid = jid.endsWith("@s.whatsapp.net") ? jid : null
    const { rows: phoneRows } = await pool.query(
      `SELECT id FROM wa_contacts
       WHERE phone = $1 OR phone_jid = $2
       ORDER BY CASE WHEN jid LIKE '%@lid' THEN 0 ELSE 1 END
       LIMIT 1`,
      [outPhone, sendJid]
    ).catch(() => ({ rows: [] as { id: number }[] }))

    let contactId0: number | null = null
    if (phoneRows[0]) {
      contactId0 = phoneRows[0].id as number
      // Patch phone + phone_jid on @lid contacts that have garbage phone
      await pool.query(`
        UPDATE wa_contacts
        SET phone     = CASE WHEN phone IS NULL OR phone NOT SIMILAR TO '[0-9]{8,15}' THEN $2 ELSE phone END,
            phone_jid = COALESCE(phone_jid, $3),
            updated_at = NOW()
        WHERE id = $1
      `, [contactId0, outPhone, sendJid]).catch(() => {})
    } else {
      const { rows: cRows } = await pool.query(
        `INSERT INTO wa_contacts (jid, name, phone, phone_jid)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (jid) DO UPDATE SET
           phone_jid = COALESCE(EXCLUDED.phone_jid, wa_contacts.phone_jid),
           updated_at = NOW()
         RETURNING id`,
        [jid, outPhone, phoneJid]
      ).catch(() => ({ rows: [] as { id: number }[] }))
      contactId0 = cRows[0]?.id ?? null
    }

    if (contactId0 === null) return

    // Você iniciou a conversa por fora (celular) com um @lid ainda não
    // resolvido — mesma correção em background do caminho de entrada
    if (jid.endsWith("@lid") && !phoneJid) {
      waitUntil(resolveLidPhoneInBackground(jid, contactId0))
    }
    await pool.query(
      `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, file_name, status, created_at)
       VALUES ($1, $2, 'out', $3, $4, $5, 'sent', COALESCE($6, NOW()))
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
         media_type = COALESCE(wa_messages.media_type, EXCLUDED.media_type),
         file_name  = COALESCE(wa_messages.file_name,  EXCLUDED.file_name)`,
      [contactId0, outMsgId, text0, outMediaType, outFileName, ts]
    )
    if (outMediaType && outMediaType !== "sticker" && outMsgId) {
      waitUntil(saveMediaBackground(msg, contactId0, outMsgId, outMediaType, "idle"))
    }
    // Operator sent manual message → extend chatbot pause by configured minutes
    pool.query(`
      UPDATE wa_contacts
      SET chatbot_paused_until = NOW() + (
            COALESCE((SELECT value FROM app_settings WHERE key = 'chatbot_idle_return_minutes'), '30')
            || ' minutes')::INTERVAL,
          updated_at = NOW()
      WHERE id = $1
    `, [contactId0]).catch(() => {})
  } catch (e) {
    console.error("[webhook] handleFromMeMessage falhou:", jid, e instanceof Error ? e.message : e)
  }
}

// Mensagem de grupo — salva em wa_group_messages. Mesmo motivo do handleFromMeMessage:
// roda por mensagem, não só na primeira do lote.
async function handleGroupMessage(msg: Record<string, unknown>, jid: string, key: Record<string, unknown>): Promise<void> {
  try {
    const msgObj = msg.message as Record<string, unknown> | undefined
    const content: string =
      (msgObj?.conversation as string) ||
      ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
      ""
    const hasMedia = !!(msgObj?.imageMessage || msgObj?.videoMessage || msgObj?.audioMessage || msgObj?.documentMessage || msgObj?.stickerMessage)
    if (!content && !hasMedia) return

    // participantAlt = real @s.whatsapp.net when participant is @lid
    const participantLid = key?.participant as string | undefined
    const participantAlt = key?.participantAlt as string | undefined
    const senderJid = participantAlt ||
      (participantLid && !participantLid.endsWith("@lid") ? participantLid : "") ||
      ""
    const senderName: string = (msg.pushName as string) || senderJid

    // Nome real do grupo (subject) não vem nessa mensagem — só no evento
    // groups.upsert (abaixo). Usar pushName aqui (nome de quem mandou a
    // mensagem, não do grupo) grava o nome errado pra sempre, já que o
    // ON CONFLICT deste INSERT nunca atualiza name — só groups.upsert atualiza.
    // Cai no jid como placeholder até groups.upsert corrigir.
    await pool.query(`
      INSERT INTO wa_groups (jid, name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (jid) DO UPDATE SET updated_at = NOW()
    `, [jid, jid]).catch(() => {})
    await pool.query(`
      INSERT INTO wa_group_messages (group_id, message_id, sender_jid, sender_name, content, media_type)
      SELECT g.id, $1, $2, $3, $4, $5
      FROM wa_groups g WHERE g.jid = $6
      ON CONFLICT (message_id) DO NOTHING
    `, [key?.id ?? null, senderJid, senderName, content || "[mídia]", hasMedia ? "media" : null, jid]).catch(() => {})
  } catch (e) {
    console.error("[webhook] handleGroupMessage falhou:", jid, e instanceof Error ? e.message : e)
  }
}

type SavedInbound = {
  contactId: number
  state: string
  lifecycle: string
  text: string
  hasMedia: boolean
  pushName: string | null
}

// Salva 1 mensagem recebida de contato normal (contato + wa_messages + download de
// mídia em background). Usado pra TODA mensagem do webhook, seja a primeira ou não —
// antes, mensagens além da primeira de um lote passavam por uma implementação
// separada e mais fraca, sem log de erro nenhum (foi assim que 2 arquivos sumiram
// sem deixar rastro). Agora é o mesmo código pra todo mundo, com erro sempre logado.
async function saveInboundMessage(evtMsg: Record<string, unknown>): Promise<SavedInbound | null> {
  const key = evtMsg.key as Record<string, unknown> | undefined
  const jid: string = (key?.remoteJid as string) || ""
  const remoteJidAlt = (key?.remoteJidAlt as string) || ""
  const msgBody = evtMsg.message as Record<string, unknown> | undefined

  const text: string =
    (msgBody?.conversation as string) ||
    ((msgBody?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    ""
  const hasMedia = !!(msgBody?.imageMessage || msgBody?.documentMessage || msgBody?.videoMessage || msgBody?.audioMessage || msgBody?.stickerMessage)
  if (!text.trim() && !hasMedia) return null

  const mediaMeta = (() => {
    if (!msgBody) return { mediaType: null as string | null, thumbnail: null as string | null, fileName: null as string | null, caption: null as string | null }
    if (msgBody.imageMessage) {
      const m = msgBody.imageMessage as Record<string, unknown>
      return { mediaType: "image", thumbnail: bufferToBase64(m.jpegThumbnail), fileName: null as string | null, caption: (m.caption as string) ?? null }
    }
    if (msgBody.videoMessage) {
      const m = msgBody.videoMessage as Record<string, unknown>
      return { mediaType: "video", thumbnail: bufferToBase64(m.jpegThumbnail), fileName: null as string | null, caption: (m.caption as string) ?? null }
    }
    if (msgBody.audioMessage) return { mediaType: "audio", thumbnail: null as string | null, fileName: null as string | null, caption: null as string | null }
    if (msgBody.documentMessage) {
      const m = msgBody.documentMessage as Record<string, unknown>
      return { mediaType: "document", thumbnail: null as string | null, fileName: (m.fileName as string) ?? null, caption: (m.caption as string) ?? null }
    }
    if (msgBody.stickerMessage) {
      const m = msgBody.stickerMessage as Record<string, unknown>
      return { mediaType: "sticker", thumbnail: bufferToBase64(m.jpegThumbnail), fileName: null as string | null, caption: null as string | null }
    }
    return { mediaType: null as string | null, thumbnail: null as string | null, fileName: null as string | null, caption: null as string | null }
  })()

  try {
    const rawPushName = (evtMsg.pushName as string) || ""
    const pushName = cleanPushName(rawPushName)
    const contact = await upsertContactFromMessage(jid, rawPushName, remoteJidAlt) as {
      id: number; state: string | null; stateData: Record<string, unknown> | null
      lifecycleState: string | null; updatedAt: string | null; lastOrderAt: string | null
    }

    // Extract quoted (reply) context
    // Evolution may hoist contextInfo to message level OR nest it inside each message type
    const contextInfo = (() => {
      if (!msgBody) return null
      if (msgBody.contextInfo) return msgBody.contextInfo as Record<string, unknown>
      const sources = [
        msgBody.extendedTextMessage,
        msgBody.imageMessage,
        msgBody.videoMessage,
        msgBody.audioMessage,
        msgBody.documentMessage,
        msgBody.stickerMessage,
      ]
      for (const s of sources) {
        const ci = (s as Record<string, unknown> | undefined)?.contextInfo
        if (ci) return ci as Record<string, unknown>
      }
      return null
    })()
    const quotedMsgId: string | null = (contextInfo?.stanzaId as string) ?? null
    const quotedContent: string | null = (() => {
      const qm = contextInfo?.quotedMessage as Record<string, unknown> | undefined
      if (!qm) return null
      return (qm.conversation as string)
        || ((qm.extendedTextMessage as Record<string, unknown>)?.text as string)
        || (qm.imageMessage    ? "🖼 Imagem"   : null)
        || (qm.videoMessage    ? "🎥 Vídeo"    : null)
        || (qm.audioMessage    ? "🎤 Áudio"    : null)
        || (qm.stickerMessage  ? "🎨 Sticker"  : null)
        || (qm.documentMessage
              ? `📄 ${(qm.documentMessage as Record<string,unknown>)?.fileName ?? "Documento"}`
              : null)
        || "[mídia]"
    })()

    const incomingMsgId: string | null = (key?.id as string) ?? null
    const msgContent = text || (hasMedia ? "[mídia]" : "")
    // Usa o timestamp real do WhatsApp para que o horário mostrado no dashboard
    // bata com o WhatsApp mesmo quando o webhook chega com atraso.
    const incomingTs = (evtMsg.messageTimestamp as number | undefined)
    const incomingCreatedAt = incomingTs ? new Date(incomingTs * 1000).toISOString() : null

    try {
      await pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_thumb, file_name, caption, quoted_id, quoted_text, created_at)
         VALUES ($1, $2, 'in', $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [
          contact.id, incomingMsgId, msgContent,
          mediaMeta.mediaType,
          mediaMeta.thumbnail ? `data:image/jpeg;base64,${mediaMeta.thumbnail}` : null,
          mediaMeta.fileName, mediaMeta.caption,
          quotedMsgId, quotedContent,
          incomingCreatedAt,
        ]
      )
    } catch (e) {
      console.error("[webhook] INSERT completo em wa_messages falhou, tentando versão simples:", jid, mediaMeta.mediaType, e instanceof Error ? e.message : e)
      try {
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_thumb, created_at)
           VALUES ($1, $2, 'in', $3, $4, $5, COALESCE($6::timestamptz, NOW()))
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [contact.id, incomingMsgId, msgContent, mediaMeta.mediaType,
           mediaMeta.thumbnail ? `data:image/jpeg;base64,${mediaMeta.thumbnail}` : null,
           incomingCreatedAt]
        )
      } catch (e2) {
        console.error("[webhook] wa_messages INSERT falhou mesmo na versão simples:", jid, mediaMeta.mediaType, e2 instanceof Error ? e2.message : e2)
      }
    }

    // Register background media download — waitUntil keeps function alive after response
    if (hasMedia && mediaMeta.mediaType) {
      waitUntil(saveMediaBackground(evtMsg, contact.id, incomingMsgId, mediaMeta.mediaType, contact.state ?? "idle"))
    }

    return {
      contactId: contact.id,
      state: contact.state ?? "idle",
      lifecycle: contact.lifecycleState ?? "new",
      text,
      hasMedia,
      pushName,
    }
  } catch (e) {
    console.error("[webhook] saveInboundMessage falhou:", jid, e instanceof Error ? e.message : e)
    return null
  }
}

// Mesmo mapeamento usado no handler de messages.update (status real que o
// WhatsApp confirmou pra mensagem) — extraído aqui pra ser reaproveitado pelo
// reconcile também, ver comentário em reconcileRecentMessages.
function mapEvoStatus(raw: string | undefined): "sent" | "delivered" | "read" | "failed" | null {
  if (!raw) return null
  return raw === "READ" || raw === "PLAYED"        ? "read"
       : raw === "DELIVERY_ACK"                     ? "delivered"
       : raw === "ERROR"                            ? "failed"
       : raw === "SERVER_ACK" || raw === "PENDING"   ? "sent"
       : null
}

// Confere as últimas mensagens desse contato direto na Evolution contra o que temos
// salvo — se alguma sumiu (ex: 2 arquivos chegando quase juntos, um se perde por
// algum motivo), recupera na hora. Roda em background (waitUntil) depois de toda
// mensagem processada, então qualquer "irmã perdida" é resgatada em segundos, não
// precisa esperar um cron passar depois.
//
// Também corrige o STATUS de mensagem que já existe aqui — o webhook messages.update
// só chega uma vez, na hora; se ele se perder por qualquer motivo, a mensagem fica
// presa em "sent" pra sempre mesmo tendo dado erro de verdade na Evolution (achado
// de auditoria 2026-07-28: contato com sessão quebrada mostrava "sent" no painel
// pra 49 de 52 mensagens que na Evolution constavam como ERROR). Como aqui sempre
// busca o histórico completo da Evolution, aproveita pra corrigir o que já existe,
// não só recuperar o que sumiu.
async function reconcileRecentMessages(jid: string): Promise<void> {
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE || jid.endsWith("@g.us")) return
  try {
    const provider = await getProvider()
    const records = await provider.findMessages({ where: { key: { remoteJid: jid } }, limit: 15 }, 8_000)
    if (records.length === 0) return

    const evoIds = records
      .map(r => (r.key as Record<string, unknown> | undefined)?.id as string | undefined)
      .filter((id): id is string => !!id)
    if (evoIds.length === 0) return

    // Resolve contactId por jid OU phone_jid (contato @lid pode ter o jid real diferente)
    const { rows: contactRows } = await pool.query(
      `SELECT id FROM wa_contacts WHERE jid = $1 OR phone_jid = $1 LIMIT 1`,
      [jid]
    )
    const contactId = contactRows[0]?.id as number | undefined
    if (!contactId) return

    const { rows: known } = await pool.query(
      `SELECT message_id, status FROM wa_messages WHERE contact_id = $1 AND message_id = ANY($2::text[])`,
      [contactId, evoIds]
    )
    const knownStatus = new Map(known.map(r => [r.message_id as string, r.status as string | null]))
    const missing = records.filter(r => {
      const id = (r.key as Record<string, unknown> | undefined)?.id as string | undefined
      return id && !knownStatus.has(id)
    })

    if (missing.length > 0) {
      console.error(`[webhook] reconcile: ${missing.length} mensagem(ns) recuperada(s) pra ${jid}`)
      for (const rec of missing) {
        const key = rec.key as Record<string, unknown> | undefined
        if (key?.fromMe) {
          await handleFromMeMessage(rec, jid, key)
        } else {
          await saveInboundMessage(rec)
        }
      }
    }

    // Corrige status desatualizado das que já existem (só as que nós mandamos)
    for (const rec of records) {
      const key = rec.key as Record<string, unknown> | undefined
      const id = key?.id as string | undefined
      if (!id || !key?.fromMe || !knownStatus.has(id)) continue

      const updates = rec.MessageUpdate as Array<{ status?: string }> | undefined
      const lastRaw = updates?.length ? updates[updates.length - 1]?.status : undefined
      const mapped = mapEvoStatus(lastRaw)
      if (!mapped || mapped === knownStatus.get(id)) continue

      await pool.query(
        `UPDATE wa_messages SET status = $1, updated_at = NOW() WHERE message_id = $2 AND direction = 'out'`,
        [mapped, id]
      ).catch(() => {})
    }
  } catch (e) {
    console.error("[webhook] reconcileRecentMessages falhou:", jid, e instanceof Error ? e.message : e)
  }
}

// Evolution sends jpegThumbnail as a Buffer serialized to {"0":255,"1":216,...} — convert to base64
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

// Reply via Evolution — wrapped in waitUntil so Vercel keeps function alive until fetch completes
function replyWA(jid: string, text: string): void {
  waitUntil(
    sendWhatsApp(jid, text).catch(e => {
      console.error("[WA-webhook] replyWA failed:", jid, e instanceof Error ? e.message : e)
    })
  )
}

// Envia E salva direto no banco (não depende do fromMe callback) — único ponto por
// onde passa toda resposta automática ao cliente. Chatbot desligado (chatbot_ativo
// = false) vira mudo aqui: nada é enviado nem salvo. Captura de pedido continua
// funcionando normalmente (ela roda antes de chegar numa chamada de reply), só a
// resposta pro cliente é que some.
async function replyAndSave(contactId: number, jid: string, text: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'chatbot_ativo'`
  ).catch(() => ({ rows: [] as { value: string }[] }))
  if (rows[0]?.value === "false") return

  // Silenciado manual ou pausa automática (operador respondeu direto pelo
  // celular) — fica mudo, mas a captura de pedido (chamada antes desse ponto)
  // já rodou normalmente. Mesmo princípio do chatbot_ativo: silêncio não é
  // isolamento da coleta de pedido.
  const { rows: contactFlags } = await pool.query(
    `SELECT COALESCE(chatbot_silenced, false) AS "chatbotSilenced", chatbot_paused_until AS "chatbotPausedUntil"
     FROM wa_contacts WHERE id = $1`,
    [contactId]
  ).catch(() => ({ rows: [] as { chatbotSilenced: boolean; chatbotPausedUntil: string | null }[] }))
  const cf = contactFlags[0]
  const isPausedTemp = cf?.chatbotPausedUntil && new Date(cf.chatbotPausedUntil) > new Date()
  if (cf?.chatbotSilenced || isPausedTemp) return

  waitUntil(
    sendWhatsApp(jid, text)
      .then(async (result) => {
        const msgId = (result as { key?: { id?: string } })?.key?.id ?? null
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, status, created_at)
           VALUES ($1, $2, 'out', $3, 'sent', NOW())
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [contactId, msgId, text]
        ).catch(() => {})
      })
      .catch(async (e) => {
        console.error("[WA-webhook] replyAndSave failed:", jid, e instanceof Error ? e.message : e)
        // Antes essa falha só ia pro console — a resposta do bot sumia sem deixar
        // rastro nenhum no dashboard. Agora grava como 'failed' mesmo sem message_id
        // (Evolution nunca respondeu um key.id porque a chamada nem completou).
        await pool.query(
          `INSERT INTO wa_messages (contact_id, direction, content, status, created_at)
           VALUES ($1, 'out', $2, 'failed', NOW())`,
          [contactId, text]
        ).catch(() => {})
      })
  )
}

// Downloads full media from Evolution, saves base64 in media_data (PostgreSQL/Railway).
async function saveMediaBackground(
  msg: unknown,
  contactId: number,
  messageId: string | null,
  mediaType: string,
  contactState: string
): Promise<void> {
  try {
    if (mediaType === "sticker") return
    const media = await downloadEvolutionMedia(msg)
    if (!media) {
      if (messageId) {
        await pool.query(
          `UPDATE wa_messages SET media_failed = TRUE WHERE message_id = $1`,
          [messageId]
        ).catch(() => {})
      }
      return
    }

    const category: MediaCategory = classifyMediaCategory(mediaType, media.mimeType, contactState)
    const dataUrl = `data:${media.mimeType};base64,${media.base64}`

    if (messageId) {
      await pool.query(
        `UPDATE wa_messages SET media_data = $1, media_category = $2, media_failed = FALSE WHERE message_id = $3`,
        [dataUrl, category, messageId]
      ).catch(() => {})
    } else {
      await pool.query(
        `UPDATE wa_messages SET media_data = $1, media_category = $2, media_failed = FALSE
         WHERE id = (SELECT id FROM wa_messages WHERE contact_id = $3 AND media_type IS NOT NULL AND media_data IS NULL ORDER BY created_at DESC LIMIT 1)`,
        [dataUrl, category, contactId]
      ).catch(() => {})
    }
  } catch (e) {
    console.error("[webhook] saveMediaBackground falhou:", messageId, mediaType, e instanceof Error ? e.message : e)
  }
}

// Parse Evolution v2 message — returns ALL messages in the payload
function parseEvolutionMsgs(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data != null && typeof data === "object") {
    const d = data as Record<string, unknown>
    if ("key" in d) return [d]
    if (Array.isArray(d.messages)) return d.messages as Record<string, unknown>[]
  }
  return []
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const event: string = body?.event ?? ""

    // Debug: store last webhook payload for inspection
    pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('debug_last_webhook', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify({ event, ts: new Date().toISOString(), preview: JSON.stringify(body).slice(0, 2000) })]
    ).catch(() => {})

    // connection.update — só log durável (nunca sobrescrito, diferente do debug_last_webhook
    // acima) do motivo real de queda de instância. Investigando desconexão de número de
    // marketing antes do primeiro envio de campanha (2x); sem isso não tinha como saber se é
    // banimento (401/loggedOut), conflito de sessão (440/replaced) ou outra causa da Evolution.
    if (event === "connection.update") {
      const d = (body?.data ?? {}) as Record<string, unknown>
      const lastDisconnect = d.lastDisconnect as Record<string, unknown> | undefined
      const errOutput = (lastDisconnect?.error as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined
      pool.query(`
        CREATE TABLE IF NOT EXISTS wa_connection_events (
          id SERIAL PRIMARY KEY,
          instance TEXT,
          state TEXT,
          status_code INTEGER,
          raw JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).then(() =>
        pool.query(
          `INSERT INTO wa_connection_events (instance, state, status_code, raw) VALUES ($1,$2,$3,$4)`,
          [body?.instance ?? null, d.state ?? null, (errOutput?.statusCode as number) ?? null, JSON.stringify(body).slice(0, 4000)]
        )
      ).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    // contacts.upsert fires the entire phonebook on connection.
    // Use it to populate missing names and phone_jid for existing contacts only.
    if (event === "contacts.upsert") {
      const cts = Array.isArray(body?.data)
        ? (body.data as Array<{ id?: string; name?: string; notify?: string }>)
        : []

      if (cts.length > 0) {
        // Fire-and-forget so webhook returns immediately
        pool.connect().then(async (cli) => {
          try {
            for (const c of cts) {
              const jid = c.id?.trim()
              if (!jid) continue

              const rawName = (c.name || c.notify || "").trim()
              const name = rawName && !/^\d+$/.test(rawName) ? rawName : null

              if (jid.endsWith("@s.whatsapp.net")) {
                const phone = jid.replace("@s.whatsapp.net", "")
                // Update name on matching @s contact AND any @lid twin with same phone
                if (name) {
                  await cli.query(`
                    UPDATE wa_contacts
                    SET name = $1, updated_at = NOW()
                    WHERE (jid = $2 OR phone = $3)
                      AND (name IS NULL OR name = '' OR name ~ '^[0-9]+$')
                  `, [name, jid, phone]).catch(() => {})
                }
                // Populate phone_jid for @lid contacts that share this phone number
                await cli.query(`
                  UPDATE wa_contacts
                  SET phone_jid = $1, updated_at = NOW()
                  WHERE phone = $2 AND jid LIKE '%@lid' AND phone_jid IS NULL
                `, [jid, phone]).catch(() => {})
              } else if (jid.endsWith("@lid") && name) {
                await cli.query(`
                  UPDATE wa_contacts
                  SET name = $1, updated_at = NOW()
                  WHERE jid = $2
                    AND (name IS NULL OR name = '' OR name ~ '^[0-9]+$')
                `, [name, jid]).catch(() => {})
              }
            }
          } catch (e) {
            console.error("[contacts.upsert] falhou:", e)
          } finally {
            cli.release()
          }
        }).catch(() => {})
      }

      return NextResponse.json({ ok: true })
    }

    // chats.upsert fires when PIV reads a chat on phone/WA Desktop (unreadCount → 0)
    // Use it to clear unread badges in our DB so the dashboard reflects the read state.
    if (event === "chats.upsert") {
      const chats: unknown[] = Array.isArray(body?.data) ? body.data : []
      waitUntil(
        Promise.all(chats.map(async (chat) => {
          const c = chat as Record<string, unknown>
          const chatJid    = c.id as string | undefined
          const unreadCount = c.unreadCount as number | undefined
          if (chatJid && unreadCount != null && unreadCount <= 0 && !chatJid.endsWith("@g.us")) {
            await pool.query(
              `UPDATE wa_messages SET read_at = NOW()
               WHERE read_at IS NULL AND direction = 'in'
                 AND contact_id = (SELECT id FROM wa_contacts WHERE jid = $1 OR phone_jid = $1 LIMIT 1)`,
              [chatJid]
            ).catch(() => {})
          }
        }))
      )
      return NextResponse.json({ ok: true })
    }

    // Handle group upserts
    if (event === "groups.upsert") {
      const items: unknown[] = Array.isArray(body?.data) ? body.data : []
      for (const item of items) {
        const it = item as Record<string, unknown>
        const jid: string = (it.id as string) || ""
        if (!jid) continue
        const name = (it.subject as string) || (it.name as string) || jid
        pool.query(
          `INSERT INTO wa_groups (jid, name, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (jid) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
          [jid, name]
        ).catch(() => {})
      }
      return NextResponse.json({ ok: true })
    }

    // Status update (delivery/read ticks). A Evolution manda `data` como OBJETO
    // ÚNICO (não array) com campos soltos (`keyId`, `status` string) — não como
    // `{key:{id}, update:{status:number}}` que o código antigo esperava. Isso fazia
    // Array.isArray(body.data) dar false e TODO update ser silenciosamente ignorado
    // (nenhuma mensagem nesse sistema jamais virou 'delivered'/'read'). Normaliza
    // pra array e aceita os dois formatos (novo string + legado numérico).
    if (event === "messages.update") {
      const raw = body?.data
      const updates: Record<string, unknown>[] = Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : raw && typeof raw === "object" ? [raw as Record<string, unknown>] : []

      waitUntil(
        Promise.all(updates.map(async (u) => {
          const k = u.key as Record<string, unknown> | undefined
          const msgId = (u.keyId as string | undefined) ?? (k?.id as string | undefined)
          if (!msgId) return
          const fromMe = Boolean(u.fromMe ?? k?.fromMe)

          const statusStrRaw = u.status as string | undefined

          // Delete pra todos chega como status "DELETED" dentro do próprio messages.update
          // nessa versão — não como evento separado. Espelha a exclusão aqui direto.
          if (statusStrRaw === "DELETED") {
            await pool.query(`DELETE FROM wa_messages WHERE message_id = $1`, [msgId]).catch(() => {})
            return
          }

          let mapped: "sent" | "delivered" | "read" | "failed" | null = mapEvoStatus(statusStrRaw)
          if (!statusStrRaw) {
            // Formato legado, numérico (mantido por segurança caso volte um dia)
            const statusCode = (u.update as Record<string, unknown> | undefined)?.status as number | undefined
            if (statusCode != null) {
              mapped = statusCode >= 4 ? "read" : statusCode >= 3 ? "delivered" : statusCode >= 2 ? "sent" : null
            }
          }
          if (!mapped) return

          let matchedRows = 0
          if (fromMe) {
            // A Evolution manda os acks fora de ordem — um SERVER_ACK ("sent") atrasado
            // chega DEPOIS do DELIVERY_ACK/READ com frequência (confirmado em teste real:
            // 5/5 mensagens do dashboard chat regrediram de "delivered" pra "sent" uns 9s
            // depois). Status só pode andar pra frente (sent < delivered < read), nunca
            // regredir — é essa regressão que fazia o ✓✓ azul "sumir".
            const r = await pool.query(
              `UPDATE wa_messages SET status = $1, updated_at = NOW()
               WHERE message_id = $2 AND direction = 'out'
                 AND CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 WHEN 'failed' THEN 0 ELSE -1 END
                   < CASE $1 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 WHEN 'failed' THEN 0 ELSE -1 END`,
              [mapped, msgId]
            ).catch(() => null)
            matchedRows = r?.rowCount ?? 0
          } else if (mapped === "read") {
            const r = await pool.query(
              `UPDATE wa_messages SET read_at = NOW(), updated_at = NOW() WHERE message_id = $1 AND direction = 'in' AND read_at IS NULL`,
              [msgId]
            ).catch(() => null)
            matchedRows = r?.rowCount ?? 0
          }

          // Log durável (não sobrescrito) — investigando por que o read-receipt (✓✓ azul)
          // só parece atualizar em mensagem mandada do celular, nunca das que saem pelo
          // nosso chat. Guarda todo evento de ack pra comparar os dois casos depois.
          pool.query(`
            CREATE TABLE IF NOT EXISTS wa_ack_events (
              id SERIAL PRIMARY KEY,
              message_id TEXT,
              from_me BOOLEAN,
              status_raw TEXT,
              mapped_status TEXT,
              matched_rows INTEGER,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `).then(() =>
            pool.query(
              `INSERT INTO wa_ack_events (message_id, from_me, status_raw, mapped_status, matched_rows) VALUES ($1,$2,$3,$4,$5)`,
              [msgId, fromMe, statusStrRaw ?? null, mapped, matchedRows]
            )
          ).catch(() => {})
        }))
      )
      return NextResponse.json({ ok: true })
    }

    // Mensagem apagada no WhatsApp ("apagar para todos", só funciona ~60h após o
    // envio — "apagar só pra mim" é local no aparelho e nunca chega aqui). Espelha
    // a exclusão em wa_messages. Mesmo formato flat de data que messages.update.
    if (event === "messages.delete") {
      const raw = body?.data
      const items: Record<string, unknown>[] = Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : raw && typeof raw === "object" ? [raw as Record<string, unknown>] : []

      waitUntil(
        Promise.all(items.map(async (it) => {
          const k = it.key as Record<string, unknown> | undefined
          const msgId =
            (it.keyId as string | undefined) ?? (k?.id as string | undefined) ?? (it.id as string | undefined)
          if (!msgId) return
          await pool.query(`DELETE FROM wa_messages WHERE message_id = $1`, [msgId]).catch(() => {})
        }))
      )
      return NextResponse.json({ ok: true })
    }

    // Conversa inteira apagada no WhatsApp — apaga as mensagens daqui também. Mantém
    // o wa_contacts (cliente, pedidos, tags) — só a conversa é efêmera, o cadastro não.
    if (event === "chats.delete") {
      const raw = body?.data
      const items: unknown[] = Array.isArray(raw) ? raw : raw != null ? [raw] : []

      waitUntil(
        Promise.all(items.map(async (it) => {
          const chatJid =
            typeof it === "string" ? it
            : ((it as Record<string, unknown>)?.remoteJid as string | undefined) ??
              ((it as Record<string, unknown>)?.id as string | undefined)
          if (!chatJid) return
          await pool.query(
            `DELETE FROM wa_messages WHERE contact_id = (SELECT id FROM wa_contacts WHERE jid = $1 OR phone_jid = $1 LIMIT 1)`,
            [chatJid]
          ).catch(() => {})
        }))
      )
      return NextResponse.json({ ok: true })
    }

    // Ignore non-message events silently
    if (event !== "messages.upsert") return NextResponse.json({ ok: true })

    const allMsgs = parseEvolutionMsgs(body?.data)
    if (allMsgs.length === 0) return NextResponse.json({ ok: true })

    // Evolution pode agrupar várias mensagens numa única chamada (ex: cliente manda
    // vários arquivos quase juntos). TODA mensagem do lote passa pelo mesmo código —
    // antes só a primeira tinha tratamento completo, as demais caíam numa implementação
    // separada e mais fraca, sem log de erro, que já deixou mensagem sumir sem rastro.
    let first: { msg: Record<string, unknown>; jid: string; saved: SavedInbound } | null = null

    for (let i = 0; i < allMsgs.length; i++) {
      const m = allMsgs[i]
      const key = (m.key as Record<string, unknown> | undefined) ?? {}
      const jid: string = (key.remoteJid as string) || ""
      if (!jid) continue

      if (key.fromMe) {
        if (!jid.endsWith("@g.us")) {
          await handleFromMeMessage(m, jid, key)
          waitUntil(reconcileRecentMessages(jid))
        }
        continue
      }

      if (jid.endsWith("@g.us")) {
        await handleGroupMessage(m, jid, key)
        continue
      }

      // Operador cadastrado mandando do próprio número? Verifica comando
      // administrativo primeiro. Se estiver no meio de um fluxo (op_produto,
      // receber_escolha...) a mensagem é sempre a resposta daquele fluxo. Se
      // estiver neutro e a mensagem não bater com nenhum comando reconhecido
      // (ex: "boa noite"), cai no chatbot de cliente normal — híbrido, não
      // exclusivo — em vez de ficar mudo.
      const remoteJidAlt = (key.remoteJidAlt as string) || ""
      const adminUser = await resolveAdminUser(jid, remoteJidAlt).catch(() => null)

      // Autocura: número que já foi vinculado como operador (linked_user_id) mas não
      // bate mais com nenhum usuário ativo — trocou de número, foi desvinculado ou
      // renomeado do lado de Usuários. Sem isso o contato fica "preso" pra sempre
      // marcado como operador, mesmo depois de desfazer o vínculo no cadastro.
      if (!adminUser) {
        pool.query(
          `UPDATE wa_contacts SET linked_user_id = NULL, updated_at = NOW()
           WHERE linked_user_id IS NOT NULL AND (jid = $1 OR phone_jid = $1 OR ($2 <> '' AND phone_jid = $2))`,
          [jid, remoteJidAlt]
        ).catch(() => {})
      }

      if (adminUser) {
        const adminMsgBody = m.message as Record<string, unknown> | undefined
        const adminText: string =
          (adminMsgBody?.conversation as string) ||
          ((adminMsgBody?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
          ""
        const midFlow = !!adminUser.waState && adminUser.waState !== "idle"
        if (midFlow || adminText.trim()) {
          const operatorContactId = await findOrCreateOperatorContact(adminUser.id, adminUser.name, adminUser.phone, jid)
            .catch(() => null)
          if (operatorContactId && adminText.trim()) {
            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content) VALUES ($1,$2,'in',$3)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
              [operatorContactId, (key.id as string) ?? null, adminText.trim()]
            ).catch(() => {})
          }
          const handled = await handleAdminMessage(jid, adminText.trim(), adminUser).catch(e => {
            console.error("[webhook] handleAdminMessage falhou:", jid, e instanceof Error ? e.message : e)
            return true
          })
          if (handled) continue
        }
        // Não é comando e não estava no meio de um fluxo — segue pro fluxo de
        // cliente normal abaixo (não faz "continue").
      }

      const saved = await saveInboundMessage(m)
      if (!first && saved) first = { msg: m, jid, saved }
      waitUntil(reconcileRecentMessages(jid))
    }

    // Só a primeira mensagem do lote dispara o chatbot (evita responder ou criar
    // pedido duplicado numa rajada quase simultânea) — mas agora TODA mensagem do
    // lote fica salva de verdade, não só a que dispara a resposta.
    if (!first) return NextResponse.json({ ok: true })

    const { jid, msg } = first
    const { contactId, state, lifecycle, text, hasMedia, pushName } = first.saved

    // Marketing opt-out — detect stop words before any chatbot logic
    if (text.trim() && !hasMedia) {
      const lower = text.toLowerCase().trim()
      const OPTOUT = ["stop", "descadastrar", "parar mensagens", "nao quero mensagens", "não quero mensagens"]
      if (OPTOUT.includes(lower)) {
        await pool.query(
          `UPDATE wa_contacts SET marketing_optout = true, updated_at = NOW() WHERE id = $1`,
          [contactId]
        ).catch(() => {})
        await replyAndSave(contactId, jid, "✅ Pronto! Você não receberá mais mensagens de marketing. Para reativar, é só nos chamar.")
        return NextResponse.json({ ok: true })
      }
    }

    // Cancelamento — só acende alerta pro operador, nunca mexe em pedido/estoque
    // sozinho (decisão de cancelar é 100% manual, do operador). Roda sempre igual,
    // não importa o estado da conversa nem se o bot está silenciado.
    if (text.trim() && !hasMedia) {
      const lowerCancel = text.toLowerCase().trim()
      if (["cancelar", "cancel", "sair", "voltar"].includes(lowerCancel)) {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', updated_at = NOW() WHERE id = $1`,
          [contactId]
        ).catch(() => {})
        await replyAndSave(contactId, jid, "Recebi! Nossa equipe entra em contato pra te ajudar. 👋")
        return NextResponse.json({ ok: true })
      }
    }

    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_silenced BOOLEAN NOT NULL DEFAULT false`).catch(() => {})
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_greeting_sent_at TIMESTAMPTZ`).catch(() => {})

    // Fetch chatbot flags (graceful — columns may not exist yet)
    let chatbotProdutoEnabled = true
    let chatbotDtfEnabled = false
    let chatbotObs: string | null = null
    try {
      const flagsRes = await pool.query(`
        SELECT
          COALESCE(chatbot_produto_enabled, true)  AS "chatbotProdutoEnabled",
          COALESCE(chatbot_dtf_enabled, false)     AS "chatbotDtfEnabled",
          chatbot_obs                              AS "chatbotObs"
        FROM wa_contacts WHERE id = $1
      `, [contactId])
      if (flagsRes.rows[0]) {
        chatbotProdutoEnabled = flagsRes.rows[0].chatbotProdutoEnabled
        chatbotDtfEnabled     = flagsRes.rows[0].chatbotDtfEnabled
        chatbotObs            = flagsRes.rows[0].chatbotObs
      }
    } catch { /* use defaults if columns not migrated yet */ }

    // Fetch global settings (produto/dtf disponibilidade, horários, etc.). Chatbot
    // desligado não bloqueia mais aqui — a captura de pedido continua rodando; quem
    // vira mudo é o replyAndSave (único ponto de resposta ao cliente), que já checa
    // chatbot_ativo sozinho antes de responder.
    const globalSettings: Record<string, string> = {}
    try {
      const { rows: gs } = await pool.query(`SELECT key, value FROM app_settings`)
      for (const r of gs) globalSettings[r.key] = r.value
    } catch { /* use defaults */ }

    const produtoDispo   = await hasProdutoDisponivel()
    const produtoBase    = getServiceStatus("produto", globalSettings)
    const produtoStatus: ServiceStatus = produtoDispo
      ? produtoBase
      : { available: false, reason: "desativado" }
    const dtfStatus      = getServiceStatus("dtf", globalSettings)

    // Silenciado manual ou pausa automática não bloqueia mais aqui — mesmo
    // princípio do chatbot_ativo acima: a captura de pedido continua rodando,
    // quem fica mudo é o replyAndSave (checa isso sozinho antes de responder).
    if (hasMedia) {
      await handleMedia(jid, contactId, msg, state, allMsgs)
    } else {
      await handleText(
        jid, contactId, state, text.trim(), lifecycle, pushName ?? "",
        chatbotProdutoEnabled, chatbotDtfEnabled, chatbotObs,
        produtoStatus, dtfStatus, globalSettings
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("WA webhook error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true }) // sempre 200 para Evolution não retentar
  }
}

// ─── helpers gerais ──────────────────────────────────────────────────────────

// ", Nome" se o pushName trouxer nome, "" se não trouxer — saudação nunca quebra
function nameSuffix(pushName: string): string {
  const first = pushName.trim().split(" ")[0]
  return first ? `, ${first}` : ""
}

async function setState(contactId: number, state: string, data: Record<string, unknown> = {}) {
  await pool.query(
    "UPDATE wa_contacts SET state = $1, state_data = $2, updated_at = NOW() WHERE id = $3",
    [state, JSON.stringify(data), contactId]
  )
}

function getGreeting(): string {
  const hour = parseInt(
    new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false })
  )
  if (hour >= 5 && hour < 12) return "Bom dia"
  if (hour >= 12 && hour < 18) return "Boa tarde"
  return "Boa noite"
}

async function tagContact(contactId: number, tag: string, value = "") {
  try {
    await pool.query(`
      INSERT INTO wa_contact_tags (contact_id, tag, value, source)
      VALUES ($1, $2, $3, 'chatbot')
      ON CONFLICT (contact_id, tag, value) DO NOTHING
    `, [contactId, tag, value])
  } catch (e) { console.error("[tagContact] falhou — migration wa_contact_tags não rodou?", e) }
}



async function getCatalog(): Promise<Array<{ name: string; sale_price: number | null; isCategory: boolean }>> {
  const { rows } = await pool.query(`
    WITH product_root AS (
      SELECT
        p.name        AS product_name,
        p.sale_price,
        COALESCE(root.name, cat.name, p.name) AS root_name
      FROM products p
      LEFT JOIN categories cat  ON cat.id  = p.category_id
      LEFT JOIN categories root ON root.id = cat.parent_id
      WHERE p.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
        AND LOWER(p.name) NOT LIKE '%dtf%'
    ),
    root_counts AS (
      SELECT root_name, COUNT(*) AS cnt FROM product_root GROUP BY root_name
    )
    SELECT DISTINCT
      CASE WHEN rc.cnt > 1 THEN pr.root_name ELSE pr.product_name END AS name,
      (rc.cnt > 1)                                                      AS "isCategory",
      CASE WHEN rc.cnt = 1 THEN pr.sale_price ELSE NULL END             AS sale_price
    FROM product_root pr
    JOIN root_counts rc ON rc.root_name = pr.root_name
    ORDER BY name
  `)
  return rows
}


async function getProductVariants(keyword: string): Promise<Array<{ color: string; size: string; productName: string; salePrice: number }>> {
  const { rows } = await pool.query(`
    SELECT DISTINCT pv.color, pv.size, p.name AS "productName",
           COALESCE(pv.sale_price, p.sale_price, 0)::float AS "salePrice"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
      AND LOWER(p.name) LIKE $1
    ORDER BY pv.color
  `, [`%${keyword.toLowerCase()}%`])
  return rows
}

async function getAllProductVariants(): Promise<Array<{ color: string; size: string; productName: string; salePrice: number }>> {
  const { rows } = await pool.query(`
    SELECT DISTINCT pv.color, pv.size, p.name AS "productName",
           COALESCE(pv.sale_price, p.sale_price, 0)::float AS "salePrice"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
      AND LOWER(p.name) NOT LIKE '%dtf%'
    ORDER BY p.name, pv.color
  `)
  return rows
}

async function resolveProductKeyword(text: string): Promise<string> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const lower = norm(text)

  const { rows } = await pool.query(`
    SELECT p.name, COALESCE(root.name, cat.name) AS root_category, COUNT(*) OVER (
      PARTITION BY COALESCE(root.name, cat.name)
    ) AS siblings
    FROM products p
    LEFT JOIN categories cat  ON cat.id  = p.category_id
    LEFT JOIN categories root ON root.id = cat.parent_id
    WHERE p.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
      AND LOWER(p.name) NOT LIKE '%dtf%'
    ORDER BY LENGTH(p.name) DESC
  `)

  // Pass 1: nome completo do produto está no texto
  for (const row of rows) {
    if (lower.includes(norm(row.name as string))) return (row.name as string).toLowerCase()
  }

  // Pass 1b: todas as palavras do produto aparecem no texto (trata singular/plural)
  // Ex: "camiseta adulto" → bate em "Camisetas Adulto"
  for (const row of rows) {
    const pWords = norm(row.name as string).split(/\s+/).filter(Boolean)
    if (pWords.length > 1 && pWords.every(pw => {
      const sing = pw.endsWith("s") ? pw.slice(0, -1) : pw
      return lower.includes(pw) || (sing !== pw && lower.includes(sing))
    })) return (row.name as string).toLowerCase()
  }

  // Pass 2: primeira palavra do produto no texto — só se raiz tem 1 produto
  for (const row of rows) {
    if (Number(row.siblings) > 1) continue  // deixa pass 4 tratar raízes com múltiplos filhos
    const firstWord = norm(row.name as string).split(/\s+/)[0]
    const singular  = firstWord.endsWith("s") ? firstWord.slice(0, -1) : firstWord
    if (lower.includes(firstWord) || (singular !== firstWord && lower.includes(singular))) {
      return (row.name as string).toLowerCase()
    }
  }

  // Pass 3: texto bate com nome de categoria raiz que tem múltiplos produtos → @CAT:
  const roots = new Map<string, number>()
  for (const row of rows) {
    const rn = row.root_category as string | null
    if (rn) roots.set(rn, (roots.get(rn) ?? 0) + 1)
  }
  for (const [rootName, cnt] of roots.entries()) {
    if (cnt <= 1) continue
    const rn = norm(rootName)
    const rFirst = rn.split(/\s+/)[0]
    const rSing  = rFirst.endsWith("s") ? rFirst.slice(0, -1) : rFirst
    if (lower.includes(rn) || lower.includes(rFirst) || (rSing !== rFirst && lower.includes(rSing))) {
      return `@CAT:${rootName}`
    }
  }

  return ""
}


async function getMostRecentOrder(contactId: number) {
  const res = await pool.query(`
    SELECT id, number, status, confirmation_requested_at AS "confirmationRequestedAt"
    FROM orders
    WHERE contact_id = $1
      AND status NOT IN ('cancelado')
      AND paid_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [contactId])
  return res.rows[0] ?? null
}

// ─── service availability ─────────────────────────────────────────────────────

type ServiceStatus = {
  available: boolean
  reason: "desativado" | "fechado_temp" | "fora_horario" | null
  retornoEm?: string
}

async function hasProdutoDisponivel(): Promise<boolean> {
  const { rows } = await pool.query(`
    SELECT 1 FROM products
    WHERE status = 'active' AND chatbot_enabled = true AND chatbot_disponivel = true
      AND LOWER(name) NOT LIKE '%dtf%'
    LIMIT 1
  `)
  return rows.length > 0
}

function getServiceStatus(service: "produto" | "dtf", s: Record<string, string>): ServiceStatus {
  const p = service

  if (s[`${p}_ativo`] === "false") return { available: false, reason: "desativado" }

  const fechadoAte = s[`${p}_fechado_ate`]
  if (fechadoAte) {
    const d = new Date(fechadoAte)
    if (d > new Date()) {
      const retorno = d.toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
      return { available: false, reason: "fechado_temp", retornoEm: retorno }
    }
  }

  const dias   = s[`${p}_horario_dias`]
  const inicio = s[`${p}_horario_inicio`]
  const fim    = s[`${p}_horario_fim`]

  if (dias && inicio && fim) {
    const nowBR      = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    const currentDay = nowBR.getDay()
    const hh         = String(nowBR.getHours()).padStart(2, "0")
    const mm         = String(nowBR.getMinutes()).padStart(2, "0")
    const currentTime = `${hh}:${mm}`
    const allowedDays = dias.split(",").map(Number)
    if (!allowedDays.includes(currentDay) || currentTime < inicio || currentTime > fim) {
      return { available: false, reason: "fora_horario" }
    }
  }

  return { available: true, reason: null }
}

function buildUnavailableMsg(
  service: "produto" | "dtf",
  status: ServiceStatus,
  otherStatus: ServiceStatus,
  s: Record<string, string>
): string {
  const isProd = service === "produto"
  const DIAS_LABEL = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]

  let base = ""
  if (status.reason === "fechado_temp") {
    base = isProd
      ? `No momento estamos sem estoque de produto.${status.retornoEm ? ` A previsão de retorno é dia ${status.retornoEm}.` : ""}`
      : `No momento o serviço de DTF está pausado.${status.retornoEm ? ` A previsão de retorno é dia ${status.retornoEm}.` : ""}`
  } else if (status.reason === "fora_horario") {
    const diasStr   = (s[`${service}_horario_dias`] ?? "").split(",").map(n => DIAS_LABEL[Number(n)] ?? "").filter(Boolean).join(", ")
    const inicio    = s[`${service}_horario_inicio`] ?? ""
    const fim       = s[`${service}_horario_fim`] ?? ""
    const servLabel = isProd ? "pedidos de produto" : "impressão DTF"
    base = `Nosso atendimento de ${servLabel} funciona ${diasStr} das ${inicio} às ${fim}. No momento estamos fora do horário.`
  } else {
    base = isProd
      ? "No momento o atendimento de pedidos de produto está pausado."
      : "No momento o serviço de DTF está pausado."
  }

  if (otherStatus.available) {
    base += isProd
      ? "\n\nMas a impressão DTF ainda está disponível. Você tem interesse?"
      : "\n\nMas ainda temos produtos disponíveis. Quer fazer um pedido?"
  }

  return base
}

// ─── catálogo ────────────────────────────────────────────────────────────────

async function sendCatalog(jid: string, contactId: number, bypassRateLimit = false) {
  await tagContact(contactId, "interessado_produto")

  if (!bypassRateLimit) {
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_catalog_sent_at TIMESTAMPTZ`).catch(() => {})
    const { rows: rateRows } = await pool.query(
      `SELECT last_catalog_sent_at FROM wa_contacts WHERE id = $1`, [contactId]
    )
    const lastSent: Date | null = rateRows[0]?.last_catalog_sent_at ? new Date(rateRows[0].last_catalog_sent_at) : null
    if (lastSent && Date.now() - lastSent.getTime() < 24 * 60 * 60 * 1000) {
      await replyAndSave(contactId, jid, "Já enviamos nosso catálogo hoje! Alguma dúvida sobre um produto específico?")
      return
    }
  }

  const catalog = await getCatalog()

  if (catalog.length === 0) {
    await replyAndSave(contactId, jid, "No momento não temos produtos disponíveis para pedido.")
    return
  }

  const emojiMap: Record<string, string> = {
    moletom: "🧥", camiseta: "👕", bermuda: "🩳", calca: "👖", calça: "👖",
    conjunto: "👗", blusa: "🧣", short: "🩳",
  }

  const lines = catalog.map(p => {
    const nameLower = p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    const emoji = Object.entries(emojiMap).find(([k]) => nameLower.includes(k))?.[1] ?? "📦"
    const price = p.sale_price && p.sale_price > 0
      ? ` · R$ ${Number(p.sale_price).toFixed(2).replace(".", ",")}`
      : ""
    return `${emoji} ${p.name}${price}`
  })

  const { rows: dtfRows } = await pool.query(
    `SELECT sale_price FROM products WHERE LOWER(name) LIKE 'dtf%' AND status = 'active' AND chatbot_enabled = true LIMIT 1`
  )
  const dtfPrice = dtfRows[0]?.sale_price
  if (dtfPrice > 0) {
    lines.push(`🖨️ Impressão DTF · R$ ${Number(dtfPrice).toFixed(2).replace(".", ",")}/metro`)
  }

  await replyAndSave(contactId, jid, `Quer ver as cores de qual produto? 👇\n\n${lines.join("\n")}\n\nMe fala o nome (ou *todos* pra ver tudo)`)
  pool.query(
    `UPDATE wa_contacts SET last_catalog_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [contactId]
  ).catch(() => {})
}

// ─── categoria com múltiplos produtos — mostra tudo de uma vez, sem drill-down ─

async function sendCategoryVariants(jid: string, contactId: number, rootCategoryName: string) {
  const { rows } = await pool.query(`
    SELECT DISTINCT p.name
    FROM products p
    JOIN categories cat  ON cat.id  = p.category_id
    JOIN categories root ON root.id = cat.parent_id
    WHERE root.name ILIKE $1
      AND p.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
    ORDER BY p.name
  `, [rootCategoryName])

  if (!rows.length) { await sendCatalog(jid, contactId, true); return }

  const blocks: string[] = []
  for (const row of rows) {
    const variants = await getProductVariants(row.name as string)
    if (variants.length) blocks.push(buildVariacaoBlock(variants[0].productName, variants))
  }
  if (!blocks.length) { await sendCatalog(jid, contactId, true); return }

  await replyAndSave(contactId, jid,
    `${blocks.join("\n\n")}\n\nQuer fazer um pedido? Me manda assim:\n_Ex: 10 preto P_`)
}

// ─── variação ────────────────────────────────────────────────────────────────

function buildVariacaoBlock(productName: string, variants: Array<{ color: string; size: string; salePrice?: number }>): string {
  const colors = [...new Set(variants.map(v => v.color).filter(Boolean))]
  const sizes  = sortSizes([...new Set(variants.map(v => v.size).filter(Boolean))])
  const prices = variants.map(v => v.salePrice ?? 0).filter(p => p > 0)
  const minP   = prices.length ? Math.min(...prices) : 0
  const maxP   = prices.length ? Math.max(...prices) : 0
  const priceStr = minP > 0
    ? (minP === maxP
        ? `R$ ${minP.toFixed(2).replace(".", ",")}`
        : `R$ ${minP.toFixed(2).replace(".", ",")} – R$ ${maxP.toFixed(2).replace(".", ",")}`)
    : null
  let block = `*${productName}*\n`
  if (priceStr)      block += `💰 ${priceStr}\n`
  if (colors.length) block += `🎨 Cores: ${colors.join(", ")}\n`
  if (sizes.length)  block += `📏 Tamanhos: ${sizes.join(", ")}`
  return block
}

async function handleVariacao(jid: string, contactId: number, text: string) {
  await tagContact(contactId, "interessado_produto")

  const norm   = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const lower  = norm(text)
  const isTodos = ["todos", "tudo", "todos os produtos", "todos produtos", "ver tudo"].includes(lower.trim())

  // "todos" → mostra todos os produtos
  if (isTodos) {
    const allVariants = await getAllProductVariants()
    if (!allVariants.length) {
      await replyAndSave(contactId, jid, "No momento não temos produtos disponíveis.")
      return
    }
    const byProduct: Record<string, Array<{ color: string; size: string }>> = {}
    for (const v of allVariants) {
      if (!byProduct[v.productName]) byProduct[v.productName] = []
      byProduct[v.productName].push({ color: v.color, size: v.size })
    }
    const blocks = Object.entries(byProduct).map(([name, vars]) => buildVariacaoBlock(name, vars))
    const productNames = Object.keys(byProduct)
    const exName = productNames[0]?.toLowerCase() ?? "produto"
    const exName2 = productNames[1]?.toLowerCase() ?? null
    const exLine = exName2
      ? `_${exName.split(" ")[0]} 10 preto P 20 cinza M\n${exName2.split(" ")[0]} 5 preto G_`
      : `_${exName.split(" ")[0]} 10 preto P 20 cinza M_`
    await replyAndSave(contactId, jid, `${blocks.join("\n\n")}\n\nQuer fazer um pedido? Me manda assim:\n${exLine}`)
    return
  }

  const keyword = await resolveProductKeyword(text)

  if (keyword.startsWith("@CAT:")) {
    await sendCategoryVariants(jid, contactId, keyword.slice(5))
    return
  }

  if (!keyword) {
    const catalog = await getCatalog()
    if (catalog.length === 0) {
      await replyAndSave(contactId, jid, "No momento não temos produtos disponíveis.")
      return
    }
    const emojiMap: Record<string, string> = {
      moletom: "🧥", camiseta: "👕", bermuda: "🩳", calca: "👖", calça: "👖", conjunto: "👗", blusa: "🧣", short: "🩳",
    }
    const nomes = catalog.map(p => {
      const nl = norm(p.name); const emoji = Object.entries(emojiMap).find(([k]) => nl.includes(k))?.[1] ?? "📦"
      return `${emoji} ${p.name}`
    }).join("\n")
    await replyAndSave(contactId, jid, `Quer ver as cores de qual produto? 👇\n\n${nomes}\n\nMe fala o nome (ou *todos* pra ver tudo)`)
    return
  }

  const variants = await getProductVariants(keyword)

  if (variants.length === 0) {
    await sendCatalog(jid, contactId)
    return
  }

  const block     = buildVariacaoBlock(variants[0].productName, variants)
  const exColor   = variants.find(v => v.color)?.color ?? "Preto"
  const exSizes   = sortSizes([...new Set(variants.map(v => v.size).filter(Boolean))])
  const exSize    = exSizes[0] ?? "M"
  const exLine    = `_${keyword.split(" ")[0]} 10 ${exColor} ${exSize} 20 ${exColor} ${exSizes[1] ?? exSize}_`

  await replyAndSave(contactId, jid, `${block}\n\nQuer fazer um pedido? Me manda assim:\n${exLine}`)
}


// ─── media ───────────────────────────────────────────────────────────────────

function msgHasMedia(m: Record<string, unknown>): boolean {
  const body = m.message as Record<string, unknown> | undefined
  return !!(body?.imageMessage || body?.documentMessage || body?.videoMessage || body?.audioMessage || body?.stickerMessage)
}

async function handleMedia(
  jid: string,
  contactId: number,
  msg: unknown,
  state: string,
  allMsgs: Record<string, unknown>[],
) {
  if (state === "dtf_coletando_arquivos") {
    const contactRes = await pool.query(`SELECT state_data FROM wa_contacts WHERE id = $1`, [contactId])
    const stateData = contactRes.rows[0]?.state_data ?? {}
    let pedidoId = stateData.pedidoId as number | undefined
    let justCreated = false
    if (!pedidoId) {
      const created = await handleDtfMedia(jid, contactId, stateData)
      if (!created) return
      pedidoId = created
      justCreated = true
    }

    // Evolution pode agrupar vários arquivos de arte no mesmo lote — vincula
    // TODOS os arquivos de mídia do lote ao pedido, não só o "msg" que disparou
    // essa chamada (antes só o primeiro do lote virava anexo, o resto sumia).
    const mediaMsgs = allMsgs.filter(msgHasMedia)
    let attached = 0
    for (const m of mediaMsgs) {
      if (await addFileToDtfPedido(pedidoId, contactId, m)) attached++
    }

    if (!justCreated && attached > 0) {
      await replyAndSave(contactId, jid, attached > 1
        ? `📎 ${attached} arquivos adicionados! Mais algum ou responda *pronto* para finalizar.`
        : `📎 Arquivo adicionado! Mais algum ou responda *pronto* para finalizar.`)
    }
    return
  }

  // Áudio: não conseguimos processar, pede texto
  const msgAudio = (msg as Record<string, unknown>).message as Record<string, unknown> | undefined
  if (msgAudio?.audioMessage) {
    await replyAndSave(contactId, jid, "Recebi o áudio, mas não consigo ouvir por aqui! 😅\n\nMe passa o pedido em texto:\n_Ex: 20 moletom preto G_")
    return
  }

  // Arquivo solto, fora de qualquer fluxo — não tenta adivinhar o que é (comprovante, arte, etc).
  // Acha ou cria um pedido DTF virgem só pra aparecer no kanban; operador vincula o arquivo manualmente.
  // Trava por advisory lock: quando o cliente manda vários arquivos quase juntos, o WhatsApp dispara
  // webhooks em paralelo — sem a trava, 2 chamadas simultâneas podem achar "sem pedido aberto" ao
  // mesmo tempo e criar 2 pedidos DTF duplicados, ou mandar "Recebi seu arquivo!" 2x.
  let ackSent = false
  let ackRowId: number | null = null
  const cliMedia = await pool.connect()
  try {
    await cliMedia.query("BEGIN")
    await cliMedia.query("SELECT pg_advisory_xact_lock($1)", [contactId])

    const { rows: openPedido } = await cliMedia.query(
      `SELECT id FROM dtf_pedidos
       WHERE contact_id = $1 AND status NOT IN ('em_producao', 'pronto', 'concluido', 'cancelado')
       ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )
    if (!openPedido[0]) {
      const numRes = await cliMedia.query(`SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`)
      await cliMedia.query(
        `INSERT INTO dtf_pedidos (number, data, contact_id, status, source) VALUES ($1, $2, $3, 'triagem', 'whatsapp')`,
        [numRes.rows[0].num, todayBR(), contactId]
      )
    }
    // O próprio pedido virgem no kanban já é o alerta — não marca needs_attention na conversa

    // Dedup: cliente pode mandar vários arquivos ao mesmo tempo — não repete a mensagem.
    // Marca a linha em wa_messages dentro da mesma trava, antes de mandar de verdade —
    // assim uma segunda chamada concorrente já enxerga o "ack" reservado, sem brecha.
    const { rows: recentAck } = await cliMedia.query(
      `SELECT 1 FROM wa_messages WHERE contact_id = $1 AND direction = 'out'
       AND content = 'Recebi seu arquivo! Já vou te atender. 😊'
       AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
      [contactId]
    )
    ackSent = recentAck.length === 0
    if (ackSent) {
      const { rows: ackRow } = await cliMedia.query(
        `INSERT INTO wa_messages (contact_id, direction, content, created_at) VALUES ($1, 'out', $2, NOW()) RETURNING id`,
        [contactId, "Recebi seu arquivo! Já vou te atender. 😊"]
      )
      ackRowId = ackRow[0]?.id ?? null
    }

    await cliMedia.query("COMMIT")
  } catch (e) {
    await cliMedia.query("ROLLBACK").catch(() => {})
    ackSent = false
    console.error("[handleMedia] falhou ao criar pedido DTF virgem / checar dedup", e)
  } finally {
    cliMedia.release()
  }

  // A linha do ack é reservada DENTRO da trava (acima) só pra garantir dedup entre
  // chamadas concorrentes — o envio de verdade e o message_id só saem depois do
  // commit. Sem gravar o message_id de volta aqui, essa linha nunca "casa" com o
  // que a Evolution reporta depois, e todo reconcile/sync recria a mesma mensagem.
  if (ackSent && ackRowId) {
    const rowId = ackRowId
    waitUntil(
      sendWhatsApp(jid, "Recebi seu arquivo! Já vou te atender. 😊")
        .then(result => {
          const msgId = (result as { key?: { id?: string } })?.key?.id
          if (!msgId) return
          return pool.query(
            `UPDATE wa_messages SET message_id = $1 WHERE id = $2 AND message_id IS NULL`,
            [msgId, rowId]
          )
        })
        .catch(e => console.error("[handleMedia] envio do ack falhou:", jid, e instanceof Error ? e.message : e))
    )
  }
}

// ─── text ────────────────────────────────────────────────────────────────────

// Chatbot minimalista: só saúda, e interpreta se a mensagem é pedido, menção a
// arquivo/DTF ou pergunta (preço/variação/catálogo). Sem estado de conversa
// multi-turn — cada mensagem é interpretada do zero, olhando direto na tabela
// orders pra saber se já existe um pedido em aberto (em vez de espelhar isso
// num wa_contacts.state que podia desalinhar).
async function handleText(
  jid: string,
  contactId: number,
  state: string,
  text: string,
  lifecycle: string,
  pushName: string,
  chatbotProdutoEnabled = true,
  chatbotDtfEnabled = false,
  chatbotObs: string | null = null,
  produtoStatus: ServiceStatus = { available: true, reason: null },
  dtfStatus: ServiceStatus     = { available: true, reason: null },
  globalSettings: Record<string, string> = {}
) {
  const lower = text.toLowerCase().trim()
  const greeting = getGreeting()
  const greetSuffix = nameSuffix(pushName)

  // Cancelamento é tratado antes, no nível do POST — sempre só acende alerta,
  // nunca chega aqui.

  // ── DTF: aguardando arquivos — cliente digitou em vez de mandar arquivo ─────
  if (state === "dtf_coletando_arquivos") {
    const done = ["pronto", "ok", "é só isso", "e so isso", "isso", "finalizar", "fim", "só isso", "so isso"]
    if (done.some(w => lower === w || lower.startsWith(w))) {
      await setState(contactId, "idle")
      await replyAndSave(contactId, jid, "✅ Pedido finalizado! Nossa equipe analisa e entra em contato em breve. 🖨️")
    } else {
      await replyAndSave(contactId, jid, "Pode mandar mais arquivos ou responda *pronto* para finalizar.")
    }
    return
  }

  // ── Atendimento humano — sempre desvia pro operador, não tenta adivinhar ────
  const atendimentoKw = ["atendimento", "atendente", "falar com", "fala com", "humano", "responsável", "responsavel"]
  if (atendimentoKw.some(k => lower.includes(k))) {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'solicitou_atendimento', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    await replyAndSave(contactId, jid, "Ok! Já aviso nossa equipe, em breve alguém te chama. 😊")
    return
  }

  // ── Reativação de "frio" — reseta contadores de lifecycle por trás; a fala
  // segue igual pra todo mundo, sem saudação especial de "bem-vindo de volta" ──
  if (lifecycle === "frio") {
    await pool.query(`
      UPDATE wa_contacts
      SET lifecycle_state = 'new', lifecycle_updated_at = NOW(),
          last_order_at = NULL, novo_seq = 0, novo_last_sent_at = NULL,
          ausente_seq = 0, ausente_last_sent_at = NULL
      WHERE id = $1
    `, [contactId])
  }

  // ── Já existe pedido em aberto? Avisa 1x por etapa e decide se continua ─────
  const openOrder = await getMostRecentOrder(contactId)

  if (openOrder) {
    // Kanban 3 estágios: "confirmando" virou sub-estado de triagem
    // (confirmation_requested_at), não é mais um status próprio.
    const pingByStatus: Record<string, string> = {
      triagem: openOrder.confirmationRequestedAt
        ? `Seu pedido *${openOrder.number}* está sendo verificado pela equipe! Se precisar de alguma alteração, é só responder aqui. 😊`
        : `Seu pedido *${openOrder.number}* está na lista! Nossa equipe já está conferindo. 😊`,
      em_separacao: `Seu pedido *${openOrder.number}* já está em separação! ✂️ Avisamos quando estiver pronto.`,
      pronto:       `Seu pedido *${openOrder.number}* está pronto para retirada! Pode vir buscar quando quiser. 😊`,
    }
    const ping = pingByStatus[openOrder.status]
    if (ping) {
      const { rows: alreadySent } = await pool.query(
        `SELECT 1 FROM wa_messages WHERE contact_id = $1 AND direction = 'out' AND content = $2 LIMIT 1`,
        [contactId, ping]
      )
      if (!alreadySent.length) await replyAndSave(contactId, jid, ping)
    }

    if (openOrder.status !== "triagem") {
      // Confirmando/em separação/pronto — só continua se for claramente um pedido novo
      const { intent } = await classifyAndParse(text, chatbotObs).catch(() => ({ intent: "outro" as const, items: [] }))
      if (intent === "pedido" && chatbotProdutoEnabled && produtoStatus.available) {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'novo_pedido', updated_at = NOW() WHERE id = $1`,
          [contactId]
        )
        await createOrderDirect(jid, contactId, [text], chatbotObs, undefined, chatbotDtfEnabled, globalSettings, openOrder.id)
      } else {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'mensagem_livre', updated_at = NOW() WHERE id = $1`,
          [contactId]
        )
      }
      return
    }
    // status === "triagem" → não retorna, a mensagem também é interpretada abaixo
    // (createOrderDirect acha essa mesma triagem sozinho e adiciona os itens nela)
  }

  // ── Interpreta a mensagem: pedido, arquivo (menção) ou pergunta ─────────────
  // "todos" sozinho é ambíguo demais pra IA classificar sem contexto de conversa —
  // atalho direto pro catálogo completo (mesma lista de palavras que handleVariacao usa)
  if (["todos", "tudo", "todos os produtos", "todos produtos", "ver tudo"].includes(lower)) {
    await handleVariacao(jid, contactId, "todos")
    return
  }

  const { intent, items: parsed } = await classifyAndParse(text, chatbotObs).catch(() => ({ intent: "outro" as const, items: [] }))

  if (intent === "pedido") {
    if (!chatbotProdutoEnabled || !produtoStatus.available) {
      await replyAndSave(contactId, jid, buildUnavailableMsg("produto", produtoStatus, dtfStatus, globalSettings))
      return
    }
    await createOrderDirect(jid, contactId, [text], chatbotObs, parsed, chatbotDtfEnabled, globalSettings)
    return
  }

  if (intent === "dtf" || ["monta o arquivo", "monta arquivo", "vc monta", "voce monta", "você monta"].some(k => lower.includes(k))) {
    if (!chatbotDtfEnabled || !dtfStatus.available) {
      await replyAndSave(contactId, jid, buildUnavailableMsg("dtf", dtfStatus, produtoStatus, globalSettings))
      return
    }
    await replyAndSave(contactId, jid, "Trabalhamos com DTF de 57cm de largura. Aqui a gente só faz a impressão — precisa do arquivo pronto pra rodar na máquina. Quando tiver, manda direto aqui! 🖨️")
    return
  }

  if (intent === "preco") {
    await sendCatalog(jid, contactId)
    return
  }

  if (intent === "variacao") {
    await handleVariacao(jid, contactId, text)
    return
  }

  if (intent === "agradecimento") {
    await replyAndSave(contactId, jid, `De nada${greetSuffix}! Qualquer coisa é só chamar. 😊`)
    return
  }

  // Saudação, ruído, ou qualquer outra coisa não reconhecida — a introdução completa
  // só vai 1x por dia por contato; nas próximas vezes no mesmo dia, manda só um
  // redirecionamento curto (evita repetir a apresentação inteira toda hora que o
  // bot não entende algo).
  const { rows: greetRows } = await pool.query(
    `SELECT (DATE(last_greeting_sent_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS "sentToday"
     FROM wa_contacts WHERE id = $1`,
    [contactId]
  ).catch(() => ({ rows: [] as { sentToday: boolean }[] }))
  const alreadyGreetedToday = greetRows[0]?.sentToday === true

  if (alreadyGreetedToday) {
    await replyAndSave(contactId, jid, "Não entendi 🤔 Pode mandar o *pedido* direto, o *arquivo* de DTF, ou dizer *catálogo* pra ver os produtos.")
  } else {
    await pool.query(`UPDATE wa_contacts SET last_greeting_sent_at = NOW() WHERE id = $1`, [contactId]).catch(() => {})
    await replyAndSave(contactId, jid, `${greeting}${greetSuffix}! 👋 Sou o atendimento da *SM Confecções* — atacado de roupas e impressão DTF.\n\nEm breve já vamos te atender, mas se quiser ir adiantando:\n• Me manda o *pedido* direto\n• Ou me manda o *arquivo* de DTF\n• Ou diga *catálogo* para ver os produtos`)
  }
}

async function createOrderDirect(
  jid: string,
  contactId: number,
  rawMessages: string[],
  chatbotObs: string | null = null,
  preParsed?: import("@/lib/ai/parseOrder").ParsedItem[],
  chatbotDtfEnabled = false,
  globalSettings: Record<string, string> = {},
  parentOrderId?: number
) {
  void chatbotDtfEnabled
  const fullText = rawMessages.join("\n")

  let parsed: import("@/lib/ai/parseOrder").ParsedItem[] = []
  try {
    parsed = preParsed && preParsed.length > 0
      ? preParsed
      : await parseOrder(fullText, chatbotObs)
  } catch { /* parsed fica vazio, cai no fallback de triagem virgem abaixo */ }

  // Item sem cor/tamanho é aceito como veio — operador completa no Gerenciador de Pedidos
  const matched = parsed.length ? await matchVariants(parsed) : []

  // Reconheceu que é pedido mas não bateu nenhum produto do catálogo — cria triagem
  // virgem (sem itens) como alerta, igual o pedido DTF. Operador monta manualmente
  // vendo a mensagem original (salva em notes) e a conversa aberta.
  if (!matched.some(m => m.matched)) {
    await createTriagemVirgem(jid, contactId, fullText, parentOrderId)
    return
  }

  const totalValue = matched.reduce((sum, m) => sum + (m.unitPrice ?? 0) * m.qty, 0)

  // Seção crítica: advisory lock por contactId evita que webhooks paralelos
  // do mesmo contato criem pedidos duplicados (race condition SELECT → INSERT)
  let orderId = 0
  let orderNumber = ""
  let isNewOrder = false

  const cli = await pool.connect()
  try {
    await cli.query("BEGIN")
    await cli.query("SELECT pg_advisory_xact_lock($1)", [contactId])

    const { rows: openTriagem } = await cli.query(
      `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
       AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )

    if (openTriagem[0]) {
      orderId     = openTriagem[0].id as number
      orderNumber = openTriagem[0].number as string
      for (const item of matched) {
        await cli.query(
          `INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice]
        )
      }
      await cli.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [orderId]
      )
    } else {
      isNewOrder = true
      const numRes = await cli.query("SELECT nextval('order_number_seq') AS n")
      const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`
      const orderRes = await cli.query(`
        INSERT INTO orders (number, contact_id, status, total_value, source, parent_order_id)
        VALUES ($1, $2, 'triagem', $3, 'whatsapp', $4)
        RETURNING id, number
      `, [number, contactId, totalValue > 0 ? totalValue : null, parentOrderId ?? null])
      orderId     = orderRes.rows[0].id as number
      orderNumber = orderRes.rows[0].number as string
      for (const item of matched) {
        await cli.query(`
          INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
      }
      await cli.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'triagem', 'chatbot', 'Pedido registrado via WhatsApp')
      `, [orderId])
      await cli.query(`
        UPDATE wa_contacts
        SET lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            last_order_at        = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [contactId])
    }

    await cli.query("COMMIT")
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    cli.release()
  }

  if (!isNewOrder) {
    // Mensagem já em triagem — continuação silenciosa. Operador vê tudo no Gerenciador de Pedidos.
    await setState(contactId, "triagem", { orderId, orderNumber })
    return
  }

  // Kanban 3 estágios: nada sai pro cliente na criação — Triagem é onde o
  // pedido é captado/alterado em silêncio. Só fala com o cliente quando o
  // operador clicar "Solicitar Confirmação" no dashboard.
  await setState(contactId, "triagem", { orderId, orderNumber })

  pool.query(`SELECT value FROM app_settings WHERE key = 'operador_jid'`).then(({ rows }) => {
    const opJid = rows[0]?.value
    if (opJid && opJid !== jid) {
      const pedLines = matched.map((m, idx) => {
        const desc = [m.productName, m.color, m.size].filter(Boolean).join(" ")
        return `${idx + 1}. ${desc} · ${m.qty}un`
      })
      const totalStr = totalValue > 0 ? ` · R$ ${totalValue.toFixed(2).replace(".", ",")}` : ""
      replyWA(opJid, `🛍️ *Novo pedido ${orderNumber}*${totalStr}\n\n${pedLines.join("\n")}`)
    }
  }).catch(() => {})
}

// Pedido reconhecido mas nenhum produto bateu com o catálogo — cria (ou reaproveita)
// uma triagem sem itens, com a mensagem original salva em notes. Operador monta
// manualmente pelo Gerenciador de Pedidos, vendo a conversa.
async function createTriagemVirgem(
  jid: string,
  contactId: number,
  fullText: string,
  parentOrderId?: number
) {
  let orderId = 0
  let orderNumber = ""
  let isNewOrder = false

  const cli = await pool.connect()
  try {
    await cli.query("BEGIN")
    await cli.query("SELECT pg_advisory_xact_lock($1)", [contactId])

    const { rows: openTriagem } = await cli.query(
      `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
       AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )

    if (openTriagem[0]) {
      orderId     = openTriagem[0].id as number
      orderNumber = openTriagem[0].number as string
      await cli.query(
        `UPDATE orders SET notes = COALESCE(notes || E'\n---\n', '') || $1 WHERE id = $2`,
        [fullText, orderId]
      )
    } else {
      isNewOrder = true
      const numRes = await cli.query("SELECT nextval('order_number_seq') AS n")
      const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`
      const orderRes = await cli.query(`
        INSERT INTO orders (number, contact_id, status, notes, source, parent_order_id)
        VALUES ($1, $2, 'triagem', $3, 'whatsapp', $4)
        RETURNING id, number
      `, [number, contactId, fullText, parentOrderId ?? null])
      orderId     = orderRes.rows[0].id as number
      orderNumber = orderRes.rows[0].number as string
      await cli.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'triagem', 'chatbot', 'Pedido registrado via WhatsApp — produto não identificado, montar manualmente')
      `, [orderId])
      await cli.query(`
        UPDATE wa_contacts
        SET lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            last_order_at        = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [contactId])
    }

    await cli.query("COMMIT")
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    cli.release()
  }

  await setState(contactId, "triagem", { orderId, orderNumber })

  if (!isNewOrder) return

  // Kanban 3 estágios: nada sai pro cliente na criação — só quando o operador
  // clicar "Solicitar Confirmação" no dashboard, já com os itens montados.
  pool.query(`SELECT value FROM app_settings WHERE key = 'operador_jid'`).then(({ rows }) => {
    const opJid = rows[0]?.value
    if (opJid && opJid !== jid) {
      replyWA(opJid, `🛍️ *Novo pedido ${orderNumber}* — sem produto identificado, revisar mensagem do cliente.`)
    }
  }).catch(() => {})
}

// ─── DTF media handler ───────────────────────────────────────────────────────

async function handleDtfMedia(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
): Promise<number | null> {
  const cli8 = await pool.connect()
  try {
    await cli8.query("BEGIN")

    const today = todayBR()
    const numRes = await cli8.query(
      `SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`
    )
    const number = numRes.rows[0].num

    const pedidoRes = await cli8.query(`
      INSERT INTO dtf_pedidos (number, data, contact_id, status, source, largura_cm)
      VALUES ($1, $2, $3, 'triagem', 'whatsapp', $4)
      RETURNING id
    `, [number, today, contactId, stateData.larguraCm ?? null])
    const pedidoId = pedidoRes.rows[0].id

    await cli8.query(
      `UPDATE wa_contacts
       SET needs_attention = true, lifecycle_state = 'active',
           lifecycle_updated_at = NOW(), last_order_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    )

    await cli8.query("COMMIT")

    await setState(contactId, "dtf_coletando_arquivos", { pedidoId, pedidoNumber: number })
    await replyAndSave(contactId, jid, `📎 Arte *${number}* recebida! Tem mais arquivos pra adicionar?\nManda agora ou responda *pronto* para finalizar.`)
    return pedidoId
  } catch (e) {
    await cli8.query("ROLLBACK").catch(() => {})
    console.error("[handleDtfMedia] falhou — migration dtf_pedidos/dtf_order_number_seq não rodou?", e)
    return null
  } finally {
    cli8.release()
  }
}

// Vincula pelo message_id específico do evento (não "a mídia mais recente do
// contato") — antes, duas mensagens de mídia quase simultâneas podiam disputar
// a mesma linha "mais recente" e uma delas nunca virava anexo. O índice único
// parcial garante que reprocessar a mesma mensagem (retry de webhook) não gera
// anexo duplicado.
async function addFileToDtfPedido(pedidoId: number, contactId: number, msg: Record<string, unknown>): Promise<boolean> {
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dtf_attach_pedido_msg
      ON dtf_order_attachments(pedido_id, wa_message_id) WHERE wa_message_id IS NOT NULL
    `).catch(() => {})

    const key = msg.key as Record<string, unknown> | undefined
    const messageId = key?.id as string | undefined
    if (!messageId) return false

    const { rows: msgRows } = await pool.query(`
      SELECT id, file_name FROM wa_messages
      WHERE contact_id = $1 AND message_id = $2 AND media_type IN ('document', 'image') AND direction = 'in'
      LIMIT 1
    `, [contactId, messageId])
    if (!msgRows[0]) return false

    const { rowCount } = await pool.query(`
      INSERT INTO dtf_order_attachments (pedido_id, wa_message_id, filename)
      VALUES ($1, $2, $3)
      ON CONFLICT (pedido_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
    `, [pedidoId, msgRows[0].id, msgRows[0].file_name])
    return (rowCount ?? 0) > 0
  } catch (e) {
    console.error("[addFileToDtfPedido]", contactId, pedidoId, e)
    return false
  }
}

