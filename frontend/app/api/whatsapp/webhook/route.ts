import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { classifyIntent } from "@/lib/ai/classifyIntent"
import { classifyAndParse } from "@/lib/ai/classifyAndParse"
import { classifyMedia } from "@/lib/ai/classifyMedia"
import { downloadEvolutionMedia, classifyMediaCategory, type MediaCategory } from "@/lib/whatsapp/media"
import { matchVariants, type MatchedItem } from "@/lib/whatsapp/matchVariant"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { todayBR } from "@/lib/tz"

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
  } catch { /* silent — never crashes webhook */ }
}

// Parse Evolution v2 message — handles: data.messages[], data[] (array), or data (single obj)
function parseEvolutionMsg(data: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(data)) return data[0] as Record<string, unknown>
  if (data != null && typeof data === "object") {
    const d = data as Record<string, unknown>
    if ("key" in d) return d
    if (Array.isArray(d.messages)) return (d.messages as unknown[])[0] as Record<string, unknown>
  }
  return undefined
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

    // Status update (delivery/read ticks)
    if (event === "messages.update") {
      const updates: unknown[] = Array.isArray(body?.data) ? body.data : []
      waitUntil(
        Promise.all(updates.map(async (upd) => {
          const u = upd as Record<string, unknown>
          const k = u.key as Record<string, unknown> | undefined
          const msgId      = k?.id as string | undefined
          const statusCode = (u.update as Record<string, unknown>)?.status as number | undefined
          if (!msgId || statusCode == null) return
          const fromMe = Boolean(k?.fromMe)
          if (fromMe) {
            const statusStr = statusCode >= 4 ? "read" : statusCode >= 3 ? "delivered" : statusCode >= 2 ? "sent" : null
            if (statusStr) {
              await pool.query(
                `UPDATE wa_messages SET status = $1, updated_at = NOW() WHERE message_id = $2 AND direction = 'out'`,
                [statusStr, msgId]
              ).catch(() => {})
            }
          } else if (statusCode >= 4) {
            await pool.query(
              `UPDATE wa_messages SET read_at = NOW(), updated_at = NOW() WHERE message_id = $1 AND direction = 'in' AND read_at IS NULL`,
              [msgId]
            ).catch(() => {})
          }
        }))
      )
      return NextResponse.json({ ok: true })
    }

    // Ignore non-message events silently
    if (event !== "messages.upsert") return NextResponse.json({ ok: true })

    const msg = parseEvolutionMsg(body?.data)
    if (!msg) return NextResponse.json({ ok: true })

    const key = msg.key as Record<string, unknown>
    const jid: string = (key?.remoteJid as string) || ""
    if (!jid) return NextResponse.json({ ok: true })

    // Resolve real @s.whatsapp.net JID for @lid contacts (Evolution 2.3.7 privacy mode)
    const remoteJidAlt = (key?.remoteJidAlt as string) || ""
    const phoneJid: string | null = jid.endsWith("@lid") && remoteJidAlt.endsWith("@s.whatsapp.net")
      ? remoteJidAlt : null

    // Save messages sent from our own WhatsApp (phone / WA Desktop) to chat history
    if (key?.fromMe) {
      if (!jid.endsWith("@g.us")) {
        const msgBody0 = msg.message as Record<string, unknown> | undefined
        let text0: string =
          (msgBody0?.conversation as string) ||
          ((msgBody0?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
          ""
        // Capture media sent from phone
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
        if (text0) {
          const outMsgId: string | null = (key?.id as string) ?? null
          const ts = key?.timestamp ? new Date(Number(key.timestamp) * 1000) : null
          const outPhone = phoneJid
          ? phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
          : jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
          // Upsert so outgoing messages to contacts never seen before are never lost
          const { rows: cRows } = await pool.query(
            `INSERT INTO wa_contacts (jid, name, phone, phone_jid)
             VALUES ($1, NULL, $2, $3)
             ON CONFLICT (jid) DO UPDATE SET
               phone_jid = COALESCE(EXCLUDED.phone_jid, wa_contacts.phone_jid),
               updated_at = NOW()
             RETURNING id`,
            [jid, outPhone, phoneJid]
          ).catch(() => ({ rows: [] as { id: number }[] }))
          if (cRows[0]) {
            const contactId0 = cRows[0].id as number
            await pool.query(
              `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, file_name, status, created_at)
               VALUES ($1, $2, 'out', $3, $4, $5, 'sent', COALESCE($6, NOW()))
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
                 media_type = COALESCE(wa_messages.media_type, EXCLUDED.media_type),
                 file_name  = COALESCE(wa_messages.file_name,  EXCLUDED.file_name)`,
              [contactId0, outMsgId, text0, outMediaType, outFileName, ts]
            ).catch(() => {})
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
          }
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Groups — save message, use participantAlt to resolve @lid → real number
    if (jid.endsWith("@g.us")) {
      const msgObj = msg.message as Record<string, unknown> | undefined
      const content: string =
        (msgObj?.conversation as string) ||
        ((msgObj?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
        ""
      const hasMedia = !!(msgObj?.imageMessage || msgObj?.videoMessage || msgObj?.audioMessage || msgObj?.documentMessage || msgObj?.stickerMessage)
      if (!content && !hasMedia) return NextResponse.json({ ok: true })

      // participantAlt = real @s.whatsapp.net when participant is @lid
      const participantLid = key?.participant as string | undefined
      const participantAlt = key?.participantAlt as string | undefined
      const senderJid = participantAlt ||
        (participantLid && !participantLid.endsWith("@lid") ? participantLid : "") ||
        ""
      const senderName: string = (msg.pushName as string) || senderJid

      const groupSubject = (msg as Record<string, unknown>).pushName as string || jid
      pool.query(`
        INSERT INTO wa_groups (jid, name, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (jid) DO UPDATE SET updated_at = NOW()
      `, [jid, groupSubject]).catch(() => {})
      pool.query(`
        INSERT INTO wa_group_messages (group_id, message_id, sender_jid, sender_name, content, media_type)
        SELECT g.id, $1, $2, $3, $4, $5
        FROM wa_groups g WHERE g.jid = $6
        ON CONFLICT (message_id) DO NOTHING
      `, [key?.id ?? null, senderJid, senderName, content || "[mídia]", hasMedia ? "media" : null, jid]).catch(() => {})

      return NextResponse.json({ ok: true })
    }

    const msgBody = msg.message as Record<string, unknown> | undefined
    const text: string =
      (msgBody?.conversation as string) ||
      ((msgBody?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
      ""

    const hasMedia = !!(msgBody?.imageMessage || msgBody?.documentMessage || msgBody?.videoMessage || msgBody?.audioMessage || msgBody?.stickerMessage)

    // Extract media type, thumbnail, filename, caption for storage
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

    if (!text.trim() && !hasMedia) return NextResponse.json({ ok: true })

    const phone = phoneJid
      ? phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      : jid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
    const rawPushName = (msg.pushName as string) || ""
    const pushName: string | null = (() => {
      const trimmed = rawPushName.trim()
      if (!trimmed) return null
      const lower = trimmed.toLowerCase()
      if (lower === "você" || lower === "voce") return null
      if (/^\d+$/.test(trimmed)) return null
      return trimmed
    })()

    const contactRes = await pool.query(`
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

    const contact = contactRes.rows[0]
    let state: string = contact.state ?? "idle"
    const stateData: Record<string, unknown> = contact.stateData ?? {}
    const lifecycle: string = contact.lifecycleState ?? "new"
    const lastOrderAt: Date | null = contact.lastOrderAt ? new Date(contact.lastOrderAt) : null

    // Reset coletando after 4h of inactivity
    if (state === "coletando" && contact.updatedAt) {
      const idleMs = Date.now() - new Date(contact.updatedAt).getTime()
      if (idleMs > 4 * 60 * 60 * 1000) {
        await pool.query("UPDATE wa_contacts SET state = 'idle', state_data = '{}' WHERE id = $1", [contact.id])
        state = "idle"
      }
    }

    // Fetch chatbot flags (graceful — columns may not exist yet)
    let chatbotProdutoEnabled = true
    let chatbotDtfEnabled = false
    let chatbotObs: string | null = null
    let chatbotPausedUntil: Date | null = null
    try {
      const flagsRes = await pool.query(`
        SELECT
          COALESCE(chatbot_produto_enabled, true)  AS "chatbotProdutoEnabled",
          COALESCE(chatbot_dtf_enabled, false)     AS "chatbotDtfEnabled",
          chatbot_obs                              AS "chatbotObs",
          chatbot_paused_until                     AS "chatbotPausedUntil"
        FROM wa_contacts WHERE id = $1
      `, [contact.id])
      if (flagsRes.rows[0]) {
        chatbotProdutoEnabled = flagsRes.rows[0].chatbotProdutoEnabled
        chatbotDtfEnabled     = flagsRes.rows[0].chatbotDtfEnabled
        chatbotObs            = flagsRes.rows[0].chatbotObs
        chatbotPausedUntil    = flagsRes.rows[0].chatbotPausedUntil
          ? new Date(flagsRes.rows[0].chatbotPausedUntil) : null
      }
    } catch { /* use defaults if columns not migrated yet */ }

    // Extract quoted (reply) context
    const contextInfo = (() => {
      if (!msgBody) return null
      const sources = [
        msgBody.extendedTextMessage,
        msgBody.imageMessage,
        msgBody.videoMessage,
        msgBody.audioMessage,
        msgBody.documentMessage,
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
        || "[mídia]"
    })()

    // Save incoming message — await garante que o INSERT completa antes do 200
    const incomingMsgId: string | null = (key?.id as string) ?? null
    const msgContent = text || (hasMedia ? "[mídia]" : "")
    // Usa o timestamp real do WhatsApp para que o horário mostrado no dashboard
    // bata com o WhatsApp mesmo quando o webhook chega com atraso.
    const incomingTs = (msg.messageTimestamp as number | undefined)
    const incomingCreatedAt = incomingTs ? new Date(incomingTs * 1000).toISOString() : null
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
    ).catch(() =>
      pool.query(
        `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_thumb, created_at)
         VALUES ($1, $2, 'in', $3, $4, $5, COALESCE($6::timestamptz, NOW()))
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [contact.id, incomingMsgId, msgContent, mediaMeta.mediaType,
         mediaMeta.thumbnail ? `data:image/jpeg;base64,${mediaMeta.thumbnail}` : null,
         incomingCreatedAt]
      ).catch(e => console.error("[webhook] wa_messages INSERT falhou:", e instanceof Error ? e.message : e))
    )

    // Register background media download — waitUntil keeps function alive after response
    if (hasMedia && mediaMeta.mediaType) {
      waitUntil(saveMediaBackground(msg, contact.id, incomingMsgId, mediaMeta.mediaType, state))
    }

    // Marketing opt-out — detect stop words before any chatbot logic
    if (text.trim() && !hasMedia) {
      const lower = text.toLowerCase().trim()
      const OPTOUT = ["stop", "descadastrar", "parar mensagens", "nao quero mensagens", "não quero mensagens"]
      if (OPTOUT.includes(lower)) {
        await pool.query(
          `UPDATE wa_contacts SET marketing_optout = true, updated_at = NOW() WHERE id = $1`,
          [contact.id]
        ).catch(() => {})
        replyWA(jid, "✅ Pronto! Você não receberá mais mensagens de marketing. Para reativar, é só nos chamar.")
        return NextResponse.json({ ok: true })
      }
    }

    // Fetch global chatbot settings
    let globalChatbotAtivo = false  // OFF by default — ativar via Settings
    let globalPedidosAuto  = true
    const globalSettings: Record<string, string> = {}
    try {
      const { rows: gs } = await pool.query(`SELECT key, value FROM app_settings`)
      for (const r of gs) {
        globalSettings[r.key] = r.value
        if (r.key === "chatbot_ativo") globalChatbotAtivo = r.value === "true"
        if (r.key === "pedidos_auto")  globalPedidosAuto  = r.value !== "false"
      }
    } catch { /* use defaults */ }

    const produtoDispo   = await hasProdutoDisponivel()
    const produtoBase    = getServiceStatus("produto", globalSettings)
    const produtoStatus: ServiceStatus = produtoDispo
      ? produtoBase
      : { available: false, reason: "desativado" }
    const dtfStatus      = getServiceStatus("dtf", globalSettings)

    // Global chatbot mudo — silently create order if pedidos_auto is on
    if (!globalChatbotAtivo) {
      if (globalPedidosAuto && text.trim() && !hasMedia) {
        await trySilentOrderCreate(contact.id, text.trim())
      }
      return NextResponse.json({ ok: true })
    }

    // Bot paused checks — permanent disable counts as pause
    const isPausedTemp = chatbotPausedUntil && chatbotPausedUntil > new Date()
    const isPausedPerm = !chatbotProdutoEnabled && !chatbotDtfEnabled
    if (state === "atendimento" || isPausedTemp || isPausedPerm) {
      // cancelar sempre recebe resposta mesmo com bot pausado
      if (!hasMedia) {
        const lcCancel = text.toLowerCase().trim()
        if (["cancelar", "cancel", "sair", "voltar"].includes(lcCancel)) {
          await pool.query(
            `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', updated_at = NOW() WHERE id = $1`,
            [contact.id]
          )
          replyWA(jid, "Recebi! Nossa equipe entra em contato agora. 👋")
        }
      }
      return NextResponse.json({ ok: true })
    }

    if (hasMedia) {
      await handleMedia(jid, contact.id, msg, text, lifecycle, state, chatbotDtfEnabled, chatbotProdutoEnabled, produtoStatus, dtfStatus, globalSettings)
    } else {
      await handleText(
        jid, contact.id, state, stateData, text.trim(), lifecycle, pushName ?? "",
        chatbotProdutoEnabled, chatbotDtfEnabled, chatbotObs, lastOrderAt,
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

function semNome(pushName: string): boolean {
  const t = pushName.trim()
  return t === "" || /^\d+$/.test(t)
}

async function setState(contactId: number, state: string, data: Record<string, unknown> = {}) {
  await pool.query(
    "UPDATE wa_contacts SET state = $1, state_data = $2, updated_at = NOW() WHERE id = $3",
    [state, JSON.stringify(data), contactId]
  )
}

// Atomic state transition — returns false if contact is no longer in fromStates (parallel webhook already advanced it)
async function setStateIf(contactId: number, newState: string, data: Record<string, unknown>, fromStates: string[]): Promise<boolean> {
  const result = await pool.query(
    `UPDATE wa_contacts SET state = $1, state_data = $2, updated_at = NOW()
     WHERE id = $3 AND state = ANY($4::text[])`,
    [newState, JSON.stringify(data), contactId, fromStates]
  )
  return (result.rowCount ?? 0) > 0
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



async function getCatalog(): Promise<Array<{ name: string; sale_price: number | null }>> {
  const { rows } = await pool.query(`
    SELECT name, sale_price
    FROM products
    WHERE status = 'active' AND chatbot_enabled = true AND chatbot_disponivel = true
      AND LOWER(name) NOT LIKE '%dtf%'
    ORDER BY name
  `)
  return rows
}

async function getProductVariants(keyword: string): Promise<Array<{ color: string; size: string; productName: string }>> {
  const { rows } = await pool.query(`
    SELECT DISTINCT pv.color, pv.size, p.name AS "productName"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
      AND LOWER(p.name) LIKE $1
    ORDER BY pv.color, pv.size
  `, [`%${keyword.toLowerCase()}%`])
  return rows
}

async function resolveProductKeyword(text: string): Promise<string> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const lower = norm(text)
  const { rows } = await pool.query(`
    SELECT name FROM products
    WHERE status = 'active' AND chatbot_enabled = true AND chatbot_disponivel = true
      AND LOWER(name) NOT LIKE '%dtf%'
    ORDER BY LENGTH(name) DESC
  `)
  // Pass 1: nome completo do produto está no texto do cliente (ex: "moletom adulto preto")
  for (const row of rows) {
    if (lower.includes(norm(row.name as string))) return (row.name as string).toLowerCase()
  }
  // Pass 2: primeira palavra do produto no texto (ex: "moletom" → "Moletom Adulto")
  for (const row of rows) {
    const firstWord = norm(row.name as string).split(/\s+/)[0]
    const singular  = firstWord.endsWith("s") ? firstWord.slice(0, -1) : firstWord
    if (lower.includes(firstWord) || (singular !== firstWord && lower.includes(singular))) {
      return (row.name as string).toLowerCase()
    }
  }
  return ""
}


async function getMostRecentOrder(contactId: number) {
  const res = await pool.query(`
    SELECT id, number, status
    FROM orders
    WHERE contact_id = $1
      AND status NOT IN ('cancelado')
      AND paid_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [contactId])
  return res.rows[0] ?? null
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    triagem:      "em triagem",
    confirmando:  "confirmando quantidades",
    em_separacao: "em separação",
    pronto:       "pronto para retirada",
    cancelado:    "cancelado",
  }
  return map[status] ?? status
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

async function sendCatalog(jid: string, contactId: number) {
  await tagContact(contactId, "interessado_produto")

  const catalog = await getCatalog()

  if (catalog.length === 0) {
    replyWA(jid, "No momento não temos produtos disponíveis para pedido.")
    return
  }

  const emojiMap: Record<string, string> = {
    moletom: "🧥", camiseta: "👕", bermuda: "🩳", calca: "👖", calça: "👖",
    conjunto: "👗", blusa: "🧣", short: "🩳",
  }

  const lines = catalog.map(p => {
    const nameLower = p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    const emoji = Object.entries(emojiMap).find(([k]) => nameLower.includes(k))?.[1] ?? "📦"
    const price = p.sale_price
      ? `R$ ${Number(p.sale_price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/un`
      : "consultar"
    return `${emoji} ${p.name} — ${price}`
  })

  const exName = catalog[0].name.toLowerCase()
  replyWA(jid, `Nossos produtos:\n\n${lines.join("\n")}\n\nQual você quer? Me passa assim:\n_Ex: 20 ${exName} preto G_`)
}

// ─── variação ────────────────────────────────────────────────────────────────

async function handleVariacao(jid: string, contactId: number, text: string) {
  await tagContact(contactId, "interessado_produto")

  const keyword = await resolveProductKeyword(text)

  if (!keyword) {
    // Sem produto identificado na pergunta → pergunta qual produto
    const catalog = await getCatalog()
    if (catalog.length === 0) {
      replyWA(jid, "No momento não temos produtos disponíveis.")
      return
    }
    const nomes = catalog.map(p => `• ${p.name}`).join("\n")
    replyWA(jid, `Cor de qual produto?\n\n${nomes}\n\nMe fala o nome que mostro as cores disponíveis.`)
    return
  }

  const variants = await getProductVariants(keyword)

  if (variants.length === 0) {
    await sendCatalog(jid, contactId)
    return
  }

  const productName = variants[0].productName
  const colors = [...new Set(variants.map(v => v.color).filter(Boolean))]
  const sizes  = [...new Set(variants.map(v => v.size).filter(Boolean))]

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const lowerText = norm(text)
  const askedColor = colors.find(c => lowerText.includes(norm(c)))
    ?? colors.find(c => c.toLowerCase().includes("preto"))
    ?? colors[0] ?? "Preto"
  const exSize = sizes[0] ?? "M"

  let msg = `*${productName}*\n`
  if (colors.length) msg += `🎨 Cores: ${colors.join(", ")}\n`
  if (sizes.length)  msg += `📏 Tamanhos: ${sizes.join(", ")}\n`
  msg += `\nMe manda assim: _20 ${keyword} ${askedColor} ${exSize}_`

  replyWA(jid, msg)
}


// ─── media ───────────────────────────────────────────────────────────────────

async function handleMedia(
  jid: string,
  contactId: number,
  msg: unknown,
  conversationContext: string,
  lifecycle: string,
  state: string,
  chatbotDtfEnabled = true,
  chatbotProdutoEnabled = true,
  produtoStatus: ServiceStatus = { available: true, reason: null },
  dtfStatus: ServiceStatus     = { available: true, reason: null },
  globalSettings: Record<string, string> = {}
) {
  if (state === "dtf_coletando") {
    const contactRes = await pool.query(`SELECT state_data FROM wa_contacts WHERE id = $1`, [contactId])
    const stateData = contactRes.rows[0]?.state_data ?? {}
    await handleDtfMedia(jid, contactId, stateData)
    return
  }

  if (state === "dtf_coletando_arquivos") {
    const contactRes = await pool.query(`SELECT state_data FROM wa_contacts WHERE id = $1`, [contactId])
    const stateData = contactRes.rows[0]?.state_data ?? {}
    const pedidoId = stateData.pedidoId as number | undefined
    if (pedidoId) {
      await addFileToDtfPedido(jid, contactId, pedidoId, msg)
    } else {
      await handleDtfMedia(jid, contactId, stateData)
    }
    return
  }

  // Áudio: não conseguimos processar, pede texto
  const msgAudio = (msg as Record<string, unknown>).message as Record<string, unknown> | undefined
  if (msgAudio?.audioMessage) {
    replyWA(jid, "Recebi o áudio, mas não consigo ouvir por aqui! 😅\n\nMe passa o pedido em texto:\n_Ex: 20 moletom preto G_")
    return
  }

  const media = await downloadEvolutionMedia(msg)
  if (!media) {
    replyWA(jid, "Recebi, mas não consegui abrir o arquivo. Pode mandar de novo?")
    return
  }

  const context = conversationContext || state
  const mediaType = await classifyMedia(media.base64, media.mimeType, context)
  const order = await getMostRecentOrder(contactId)

  if (mediaType === "pix") {
    const dataUrl = `data:${media.mimeType};base64,${media.base64}`
    if (order) {
      await pool.query(`
        INSERT INTO order_attachments (order_id, type, blob_url, filename, mime_type)
        VALUES ($1, 'pix_comprovante', $2, $3, $4)
      `, [order.id, dataUrl, media.filename, media.mimeType])
      await pool.query(`UPDATE orders SET has_attachment = true WHERE id = $1`, [order.id])
      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, $2, 'chatbot', 'Comprovante PIX recebido')
      `, [order.id, order.status])
      replyWA(jid, `✅ Recebi o comprovante! Já anotei no pedido *${order.number}*. Nossa equipe confirma em breve.`)
    } else {
      replyWA(jid, "Recebi o comprovante! Assim que seu pedido for registrado nossa equipe já vincula.")
    }
  } else if (mediaType === "dtf") {
    void chatbotDtfEnabled; void dtfStatus; void produtoStatus; void globalSettings
    await handleDtfMedia(jid, contactId, {})
  } else {
    void lifecycle
    replyWA(jid, "Recebi! Isso é um comprovante de pagamento ou uma arte pra impressão? Me fala.")
  }
}

// ─── text ────────────────────────────────────────────────────────────────────

async function handleText(
  jid: string,
  contactId: number,
  state: string,
  stateData: Record<string, unknown>,
  text: string,
  lifecycle: string,
  pushName: string,
  chatbotProdutoEnabled = true,
  chatbotDtfEnabled = false,
  chatbotObs: string | null = null,
  lastOrderAt: Date | null = null,
  produtoStatus: ServiceStatus = { available: true, reason: null },
  dtfStatus: ServiceStatus     = { available: true, reason: null },
  globalSettings: Record<string, string> = {}
) {
  const lower = text.toLowerCase().trim()

  if (lower === "cancelar" || lower === "cancel" || lower === "sair" || lower === "voltar") {
    // Estados DTF e cross-sell: apenas reseta para idle sem buscar pedido
    if (state === "dtf_coletando") {
      await setState(contactId, "idle")
      replyWA(jid, "Ok! Me chama quando precisar. 😊")
      return
    }

    const order = await getMostRecentOrder(contactId)

    if (order?.status === "pronto") {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      replyWA(jid, `Seu pedido *${order.number}* já está separado. Preciso acionar a equipe — eles entram em contato agora.`)
      return
    }

    if (order?.status === "em_separacao") {
      await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [order.id])
      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'cancelado', 'chatbot', 'Cliente solicitou cancelamento durante separação')
      `, [order.id])
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', state = 'idle', state_data = '{}', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      replyWA(jid, `Ok! Avisamos a equipe para parar a separação do pedido *${order.number}*.`)
      return
    }

    if (order && ["triagem", "confirmando"].includes(order.status)) {
      await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [order.id])
      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'cancelado', 'chatbot', 'Cliente solicitou cancelamento via WhatsApp')
      `, [order.id])
    }

    await setState(contactId, "idle")
    replyWA(jid, "Ok, cancelado. Quando precisar é só chamar.")
    return
  }

  // Frio reactivation — trata como novo
  if (lifecycle === "frio") {
    await pool.query(`
      UPDATE wa_contacts
      SET lifecycle_state      = 'new',
          lifecycle_updated_at = NOW(),
          state                = 'idle',
          state_data           = '{}',
          last_order_at        = NULL,
          novo_seq             = 0,
          novo_last_sent_at    = NULL,
          ausente_seq          = 0,
          ausente_last_sent_at = NULL
      WHERE id = $1
    `, [contactId])
    if (semNome(pushName)) {
      await setState(contactId, "aguardando_nome")
      replyWA(jid, "Oi! Como posso te chamar?")
      return
    }
    const greetingFrio = getGreeting()
    const firstNameFrio = pushName.split(" ")[0]
    await setState(contactId, "coletando", { rawMessages: [] })
    replyWA(jid, `${greetingFrio}, ${firstNameFrio}! Que bom te ver de volta. Me manda o pedido direto ou responde *catálogo* para ver os produtos.`)
    return
  }

  // Auto-correct state mismatch: state=idle but active order exists (e.g. bot resumed from pause)
  if (state === "idle") {
    const { rows: activeRows } = await pool.query(`
      SELECT id, number, status FROM orders
      WHERE contact_id = $1 AND status IN ('triagem', 'em_separacao', 'pronto') AND paid_at IS NULL
      AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at DESC LIMIT 1
    `, [contactId])
    if (activeRows[0]) {
      state = activeRows[0].status as string
      stateData = { orderId: activeRows[0].id, orderNumber: activeRows[0].number }
    }
  }

  switch (state) {
    case "idle":
      await handleIdle(jid, contactId, text, lifecycle, pushName, chatbotProdutoEnabled, chatbotDtfEnabled, chatbotObs, lastOrderAt, produtoStatus, dtfStatus, globalSettings)
      break

    case "coletando":
      await handleColetando(jid, contactId, stateData, text, chatbotDtfEnabled, globalSettings)
      break

    case "aguardando_cliente_1":
      await handleAguardandoCliente1(jid, contactId, stateData, text, chatbotDtfEnabled)
      break

    case "dtf_coletando": {
      const reminded = Number(stateData.dtfReminderCount ?? 0)
      if (reminded === 0) {
        replyWA(jid, "Pode mandar sua arte aqui! 🖨️")
        await setState(contactId, "dtf_coletando", { ...stateData, dtfReminderCount: 1 })
      }
      break
    }

    case "dtf_coletando_arquivos": {
      const lower = text.toLowerCase().trim()
      const done = ["pronto", "ok", "é só isso", "e so isso", "isso", "finalizar", "fim", "só isso", "so isso"]
      if (done.some(w => lower === w || lower.startsWith(w))) {
        await setState(contactId, "idle")
        const pedNum = stateData.pedidoNumber as string ?? ""
        replyWA(jid, `✅ Pedido *${pedNum}* finalizado! Nossa equipe analisa e entra em contato em breve. 🖨️`)
      } else {
        replyWA(jid, "Pode mandar mais arquivos ou responda *pronto* para finalizar.")
      }
      break
    }

    case "aguardando_nome":
      await handleAguardandoNome(jid, contactId, text)
      break

    case "aguardando_separacao_resposta":
      await handleAguardandoSeparacaoResposta(jid, contactId, stateData, text)
      break

    case "aguardando_cancelamento_resposta":
      await handleAguardandoCancelamentoResposta(jid, contactId, stateData, text)
      break

    case "aguardando_reserva_resposta":
      await handleAguardandoReservaResposta(jid, contactId, stateData, text)
      break

    default:
      // triagem / confirmando / em_separacao / pronto — pedido ativo
      await handleActiveOrder(jid, contactId, state, stateData, text, pushName, chatbotDtfEnabled, globalSettings)
  }
}

async function handleAguardandoNome(jid: string, contactId: number, text: string) {
  const nome = text.trim().replace(/[^a-zA-ZÀ-ÿ\s]/g, "").trim()
  if (!nome || nome.length < 2) {
    replyWA(jid, "Pode me passar seu nome pra eu te atender melhor?")
    return
  }
  await pool.query("UPDATE wa_contacts SET name = $1, updated_at = NOW() WHERE id = $2", [nome, contactId])
  const firstName = nome.split(" ")[0]
  const greeting = getGreeting()
  await setState(contactId, "coletando", { rawMessages: [] })
  replyWA(jid, `${greeting}, ${firstName}! 👋 Em breve já vamos te atender, mas se quiser ir adiantando:\n• Me manda o *pedido* direto\n• Ou responde *catálogo* para ver os produtos`)
}

async function handleIdle(
  jid: string,
  contactId: number,
  text: string,
  lifecycle: string,
  pushName: string,
  chatbotProdutoEnabled = true,
  chatbotDtfEnabled = false,
  chatbotObs: string | null = null,
  lastOrderAt: Date | null = null,
  produtoStatus: ServiceStatus = { available: true, reason: null },
  dtfStatus: ServiceStatus     = { available: true, reason: null },
  globalSettings: Record<string, string> = {}
) {
  void lifecycle
  const firstName = pushName.split(" ")[0] || pushName
  const greeting = getGreeting()

  // Returning client — direct flow
  if (lastOrderAt) {
    const { intent, items: preParsed } = await classifyAndParse(text, chatbotObs)

    if (intent === "pedido") {
      if (!chatbotProdutoEnabled || !produtoStatus.available) {
        replyWA(jid, buildUnavailableMsg("produto", produtoStatus, { available: false, reason: null }, globalSettings))
        return
      }
      const ok = await setStateIf(contactId, "coletando", { rawMessages: [text], chatbotObs }, ["idle"])
      if (!ok) return
      replyWA(jid, `${greeting}, ${firstName}! Já vou organizar seu pedido. 📋`)
      await createOrderDirect(jid, contactId, [text], chatbotObs, preParsed, chatbotDtfEnabled, globalSettings)
      return
    }

    if (intent === "dtf") {
      replyWA(jid, "Aqui a gente só faz a impressão — manda o arquivo direto aqui quando tiver pronto! 🖨️")
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

    if (intent === "status") {
      const res = await pool.query(`
        SELECT number, status FROM orders
        WHERE contact_id = $1
        ORDER BY created_at DESC LIMIT 1
      `, [contactId])
      if (res.rows[0]) {
        replyWA(jid, `Seu pedido *${res.rows[0].number}* está: *${statusLabel(res.rows[0].status)}*`)
      } else {
        await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
        replyWA(jid, `${greeting}, ${firstName}! Qual o pedido de hoje?`)
      }
      return
    }

    // saudacao ou outro — retornando
    await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
    replyWA(jid, `${greeting}, ${firstName}! Qual o pedido de hoje?`)
    return
  }

  // New client — ask name if missing
  if (semNome(pushName)) {
    await setState(contactId, "aguardando_nome")
    replyWA(jid, "Oi! Como posso te chamar?")
    return
  }

  // New client with name — detect intent
  const { intent: newIntent, items: newParsed } = await classifyAndParse(text, chatbotObs).catch(() => ({ intent: "outro" as const, items: [] }))

  if (newIntent === "pedido" && chatbotProdutoEnabled && produtoStatus.available) {
    const ok = await setStateIf(contactId, "coletando", { rawMessages: [text], chatbotObs }, ["idle"])
    if (ok) {
      replyWA(jid, `${greeting}, ${firstName}! Já vou organizar seu pedido. 📋`)
      await createOrderDirect(jid, contactId, [text], chatbotObs, newParsed, chatbotDtfEnabled, globalSettings)
      return
    }
  }

  if (newIntent === "dtf") {
    replyWA(jid, "Aqui a gente só faz a impressão — precisa do arquivo pronto pra rodar na máquina. Quando tiver, manda direto aqui! 🖨️")
    return
  }

  if (newIntent === "preco") {
    await sendCatalog(jid, contactId)
    await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
    return
  }

  if (newIntent === "variacao") {
    await handleVariacao(jid, contactId, text)
    await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
    return
  }

  // Generic greeting → intro message
  await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
  replyWA(jid, `${greeting}, ${firstName}! 👋 Sou o atendimento da *SM Confecções* — atacado de roupas e impressão DTF.\n\nEm breve já vamos te atender, mas se quiser ir adiantando:\n• Me manda o *pedido* direto\n• Ou responde *catálogo* para ver os produtos`)
}

async function handleColetando(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string,
  chatbotDtfEnabled = false,
  globalSettings: Record<string, string> = {}
) {
  const rawMessages  = (stateData.rawMessages as string[] ?? []).concat(text)
  const chatbotObs   = stateData.chatbotObs as string | null ?? null
  const smartGreeted = stateData.smartGreeted as boolean ?? false

  const lower = text.toLowerCase().trim()

  // Se veio do smart greeting e é a primeira resposta do cliente, aceita negação graciosamente
  if (smartGreeted && (stateData.rawMessages as string[] ?? []).length === 0) {
    const isNegation = ["não", "nao", "n", "no", "não preciso", "nao preciso", "agora não", "agora nao", "hoje não", "hoje nao"]
      .some(w => lower === w || lower.startsWith(w + " "))
    if (isNegation) {
      await setState(contactId, "idle")
      replyWA(jid, "Ok! Me chama quando precisar.")
      return
    }
  }

  // Pergunta de preço → mostra catálogo (keywords específicas pra evitar capturar "quanto vai dar de X moletom")
  const priceTerms = ["preço", "preco", "tabela", "quanto custa", "quanto vale",
    "quanto fica", "qual o valor", "qual valor", "me passa o preço", "me manda o preço", "custa?", "valores"]
  if (priceTerms.some(k => lower.includes(k))) {
    await sendCatalog(jid, contactId)
    return
  }

  // Ruído: saudações e mensagens sem conteúdo de pedido → não acumula em rawMessages
  const isNoise = /^(oi|olá|ola|ok|okay|blz|beleza|tá|ta|sim|s|👍|✅|😊|🙏|valeu|obg|obrigad|pi|pe|po|pu|né|ne|aí|ai|hm|hmm|ah|eh|é|e|opa|eae|eaí|eai)$/.test(lower)
    || (lower.length <= 3 && !/^\d/.test(lower) && !["não","nao"].includes(lower))
  if (isNoise && (stateData.rawMessages as string[] ?? []).length === 0) {
    replyWA(jid, "Me manda o pedido: produto, cor e tamanho. Ex: _20 moletom preto G_")
    return
  }

  // Pergunta de cor/tamanho → mostra variações sem sair do fluxo
  if (/\bcor\b/.test(lower) || /\bcores\b/.test(lower) || /\btamanho\b/.test(lower) || /\btamanhos\b/.test(lower) || lower.includes("disponivel") || lower.includes("disponível")) {
    await handleVariacao(jid, contactId, text)
    return
  }

  // DTF intent dentro de coletando → resposta direta (não fazemos criação de arte)
  const dtfTriggers = ["dtf", "impressão", "impressao", "imprimir", "metro de dtf", "arte dtf", "arquivo dtf", "arquivo pronto"]
  if (dtfTriggers.some(k => lower.includes(k))) {
    replyWA(jid, "Pode mandar o arquivo de DTF direto aqui! 🖨️")
    return
  }

  await setState(contactId, "coletando", { rawMessages, chatbotObs })
  await createOrderDirect(jid, contactId, rawMessages, chatbotObs, undefined, chatbotDtfEnabled, globalSettings)
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

  let parsed
  try {
    parsed = preParsed && preParsed.length > 0
      ? preParsed
      : await parseOrder(fullText, chatbotObs)
  } catch {
    replyWA(jid, "Não entendi direito. Me passa produto, cor e tamanho de cada item.")
    return
  }

  if (!parsed.length) {
    const kw = await resolveProductKeyword(fullText)
    if (kw) {
      const variants = await getProductVariants(kw)
      if (variants.length > 0) {
        const name   = variants[0].productName
        const colors = [...new Set(variants.map(v => v.color).filter(Boolean))]
        const sizes  = [...new Set(variants.map(v => v.size).filter(Boolean))]
        let msg = `*${name}*\n`
        if (colors.length) msg += `🎨 Cores: ${colors.join(", ")}\n`
        if (sizes.length)  msg += `📏 Tamanhos: ${sizes.join(", ")}\n`
        msg += `\nMe passa quantidade, cor e tamanho. Ex: _20 ${kw} ${colors[0] ?? "preto"} ${sizes[0] ?? "M"}_`
        replyWA(jid, msg)
        return
      }
    }
    // Nenhum produto identificado: reseta rawMessages para não acumular lixo
    await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
    await sendCatalog(jid, contactId)
    return
  }

  // Rejeitar itens sem cor ou tamanho — pede detalhes de TODOS os incompletos antes de criar
  const incomplete = parsed.filter(p => !p.color || !p.size)
  if (incomplete.length > 0) {
    const blocks: string[] = []
    for (const item of incomplete) {
      const kw = await resolveProductKeyword(item.productName)
      const missingParts: string[] = []
      if (!item.color) missingParts.push("cor")
      if (!item.size)  missingParts.push("tamanho")

      if (kw) {
        const variants = await getProductVariants(kw)
        if (variants.length > 0) {
          const name   = variants[0].productName
          const colors = [...new Set(variants.map(v => v.color).filter(Boolean))]
          const sizes  = [...new Set(variants.map(v => v.size).filter(Boolean))]
          let block = `*${name}* — faltou ${missingParts.join(" e ")}\n`
          if (!item.color && colors.length) block += `🎨 ${colors.join(", ")}\n`
          if (!item.size  && sizes.length)  block += `📏 ${sizes.join(", ")}`
          blocks.push(block.trimEnd())
          continue
        }
      }
      blocks.push(`*${item.productName}* — me passa ${missingParts.join(" e ")}`)
    }

    const header = incomplete.length === 1
      ? "Faltou informação:\n\n"
      : "Faltaram informações em alguns itens:\n\n"
    replyWA(jid, `${header}${blocks.join("\n\n")}\n\nMe manda o pedido completo com todos os itens.`)
    return
  }

  const matched = await matchVariants(parsed)
  const hasUnmatched  = matched.some(m => !m.matched)
  const hasStockIssue = matched.some(m => m.matched && !m.stockOk)
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
    const lines = matched.map(m => `• ${[m.productName, m.color, m.size].filter(Boolean).join(" ")} · *${m.qty} un*`)
    let reply = `✅ Adicionado ao pedido *${orderNumber}*:\n\n${lines.join("\n")}`
    if (hasUnmatched)  reply += `\n\n⚠️ Itens não encontrados serão verificados pela equipe.`
    if (hasStockIssue) reply += `\n\n⚠️ Alguns itens com estoque insuficiente — equipe confirma.`
    reply += `\n\nPode mandar mais itens se precisar!`
    replyWA(jid, reply)
    await setState(contactId, "triagem", { orderId, orderNumber })
    return
  }

  const lines = matched.map((m, idx) => {
    const desc  = [m.productName, m.color, m.size].filter(Boolean).join(" ")
    const price = m.unitPrice ? ` · R$ ${(m.unitPrice * m.qty).toFixed(2)}` : ""
    let warn = ""
    if (!m.matched) {
      warn = m.alternatives.length
        ? ` ⚠️ (disponível: ${m.alternatives.join(", ")})`
        : " ⚠️ não encontrado"
    } else if (!m.stockOk) {
      warn = m.currentStock === 0
        ? " ⚠️ sem estoque"
        : ` ⚠️ temos só ${m.currentStock} em estoque`
    }
    return `${idx + 1}. ${desc} · *${m.qty} un*${price}${warn}`
  })

  let reply = `✅ Pedido *${orderNumber}* anotado!\n\n${lines.join("\n")}`
  if (hasUnmatched)  reply += `\n\n⚠️ Itens não encontrados serão verificados pela equipe.`
  if (hasStockIssue) reply += `\n\n⚠️ Alguns itens com estoque insuficiente — equipe confirma.`

  // ── Controle de estoque automático ─────────────────────────────────────────
  const controleAtivo = globalSettings.controle_estoque_ativo === "true"

  if (controleAtivo && isNewOrder) {
    const outOfStock   = matched.filter(m => m.matched && !m.stockOk)
    const inStockItems = matched.filter(m => !m.matched || m.stockOk)

    if (outOfStock.length === 0 && !hasUnmatched) {
      // Tudo em estoque e todos os itens foram encontrados → avança direto para separação
      const orderCli = await pool.connect()
      try {
        await orderCli.query("BEGIN")
        await orderCli.query(
          `UPDATE orders SET status = 'em_separacao', needs_print = true WHERE id = $1`, [orderId]
        )
        await orderCli.query(`
          INSERT INTO order_events (order_id, status, actor, note)
          VALUES ($1, 'em_separacao', 'chatbot', 'Avançado automaticamente — estoque OK')
        `, [orderId])
        for (const item of matched) {
          if (item.variantId) {
            await orderCli.query(`
              INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
              VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)
            `, [item.variantId, item.qty, `Pedido ${orderNumber}`])
          }
        }
        await orderCli.query("COMMIT")
      } catch (e) {
        await orderCli.query("ROLLBACK").catch(() => {})
        throw e
      } finally {
        orderCli.release()
      }
      await setState(contactId, "em_separacao", { orderId, orderNumber })
      replyWA(jid, `✅ Pedido *${orderNumber}* recebido! Já estamos separando. Avisamos quando pronto para retirada!`)
      return
    }

    // Há itens faltando
    const missingNames = outOfStock.map(m =>
      [m.productName, m.color, m.size].filter(Boolean).join(" ")
    )

    // Verifica se existem prod_orders em_andamento para os produtos faltantes
    const missingVarIds = outOfStock.filter(m => m.variantId).map(m => m.variantId as string)
    let hasProdOrders = false
    const variantProdOrderMap: Record<string, boolean> = {}
    if (missingVarIds.length > 0) {
      const { rows: prodOrds } = await pool.query(`
        SELECT DISTINCT pv.id AS variant_id
        FROM prod_orders po
        JOIN prod_order_items poi ON poi.order_id = po.id
        JOIN product_variants pv ON pv.product_id = poi.product_id
        WHERE po.status = 'em_andamento' AND pv.id::text = ANY($1::text[])
      `, [missingVarIds])
      hasProdOrders = prodOrds.length > 0
      for (const r of prodOrds) variantProdOrderMap[String(r.variant_id)] = true
    }

    // Busca os order_item IDs dos itens disponíveis para preservar
    const { rows: allOrderItems } = await pool.query(
      `SELECT id, variant_id FROM order_items WHERE order_id = $1`, [orderId]
    )
    const availableItemIds: number[] = allOrderItems
      .filter((oi: { id: number; variant_id: string }) =>
        !outOfStock.some(m => String(m.variantId) === String(oi.variant_id))
      )
      .map((oi: { id: number }) => oi.id)

    const missingItems = outOfStock.map(m => ({
      variantId: m.variantId ?? null,
      name: [m.productName, m.color, m.size].filter(Boolean).join(" "),
      qty: m.qty,
      withReserva: m.variantId ? Boolean(variantProdOrderMap[String(m.variantId)]) : false,
    }))

    // Cenário D: TUDO faltando
    if (inStockItems.length === 0) {
      if (hasProdOrders) {
        await setState(contactId, "aguardando_separacao_resposta", {
          orderId, orderNumber, missingItems, availableItemIds: [], allMissing: true,
        })
        replyWA(jid, `Oi! Recebi seu pedido *${orderNumber}*, mas os itens estão em produção e chegam em breve.\n\nPosso te avisar quando estiver disponível para separar?`)
      } else {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'estoque' WHERE id = $1`, [contactId]
        )
        await setState(contactId, "triagem", { orderId, orderNumber })
        replyWA(jid, `Oi! Recebi seu pedido *${orderNumber}*, mas infelizmente não temos os itens em estoque no momento. Nossa equipe entra em contato para te ajudar!`)
      }
      return
    }

    // Cenário parcial: alguns disponíveis, alguns faltando
    const missingStr = missingNames.length === 1
      ? `*${missingNames[0]}*`
      : missingNames.map(n => `• *${n}*`).join("\n")

    const introMissing = missingNames.length === 1
      ? `a ${missingStr} não temos em estoque agora`
      : `esses itens não temos em estoque agora:\n${missingStr}`

    const reservaHint = hasProdOrders
      ? ` (está em produção e chega em breve)`
      : ""

    await setState(contactId, "aguardando_separacao_resposta", {
      orderId, orderNumber, missingItems, availableItemIds,
    })
    replyWA(jid, `Oi! Recebi seu pedido *${orderNumber}*, mas ${introMissing}${reservaHint}.\n\nPosso separar o restante?`)
    return
  }

  // Fluxo normal sem controle de estoque ativo
  await setState(contactId, "triagem", { orderId, orderNumber })
  reply += `\n\nPode me mandar mais itens se precisar. Nossa equipe confirma e avisa quando estiver pronto!`

  replyWA(jid, reply)

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

async function handleAguardandoCliente1(
  jid: string,
  contactId: number,
  _stateData: Record<string, unknown>,
  _text: string,
  _chatbotDtfEnabled = false
) {
  // Estado legado — migração para novo fluxo de acumulação
  await setState(contactId, "idle")
  replyWA(jid, "Me manda o pedido de novo pra eu registrar! 😊")
}

async function handleActiveOrder(
  jid: string,
  contactId: number,
  state: string,
  stateData: Record<string, unknown>,
  text: string,
  pushName: string,
  chatbotDtfEnabled = false,
  globalSettings: Record<string, string> = {}
) {
  const lower = text.toLowerCase().trim()

  // Estado confirmando: espera SIM/NÃO do cliente antes de qualquer outra lógica
  if (state === "confirmando") {
    const orderId     = stateData?.orderId     as number | undefined
    const orderNumber = stateData?.orderNumber as string | undefined
    const isSim = ["sim", "s", "yes", "confirmo"].includes(lower)
    const isNao = ["não", "nao", "n", "no"].includes(lower)

    if (isSim && orderId) {
      const cli7 = await pool.connect()
      try {
        await cli7.query("BEGIN")
        await cli7.query(`SELECT pg_advisory_xact_lock($1)`, [contactId])
        await cli7.query(
          `UPDATE orders SET status = 'em_separacao', needs_print = true WHERE id = $1`, [orderId]
        )
        await cli7.query(`
          INSERT INTO order_events (order_id, status, actor, note)
          VALUES ($1, 'em_separacao', 'chatbot', 'Confirmado pelo cliente via WhatsApp')
        `, [orderId])
        const { rows: already } = await cli7.query(`
          SELECT 1 FROM stock_movements WHERE channel = 'chatbot' AND notes = $1 LIMIT 1
        `, [`Pedido ${orderNumber}`])
        if (!already.length) {
          const { rows: items } = await cli7.query(
            `SELECT variant_id, qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`, [orderId]
          )
          for (const item of items) {
            await cli7.query(
              `INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
               VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)`,
              [item.variant_id, item.qty, `Pedido ${orderNumber}`]
            )
          }
        }
        await cli7.query("COMMIT")
      } catch (e) {
        await cli7.query("ROLLBACK").catch(() => {})
        console.error("[confirmando] transação falhou:", e)
      } finally {
        cli7.release()
      }
      await setState(contactId, "em_separacao", { orderId, orderNumber })
      replyWA(jid, `✅ Perfeito! Pedido *${orderNumber}* confirmado e em separação. Avisaremos quando estiver pronto para retirada!`)
      return
    }

    if (isNao && orderId) {
      await pool.query(`UPDATE orders SET status = 'triagem' WHERE id = $1`, [orderId])
      await pool.query(
        `INSERT INTO order_events (order_id, status, actor, note)
         VALUES ($1, 'triagem', 'chatbot', 'Cliente pediu ajuste via WhatsApp')`,
        [orderId]
      )
      await setState(contactId, "triagem", { orderId, orderNumber })
      replyWA(jid, `Tudo bem! Me fala o que quer ajustar no pedido *${orderNumber ?? ""}* — pode mudar quantidade, adicionar ou remover itens. Quando estiver certo é só responder *confirmar*.`)

      // Notifica operador se configurado
      pool.query(`SELECT value FROM app_settings WHERE key = 'operador_jid'`).then(({ rows }) => {
        const opJid = rows[0]?.value
        if (opJid) replyWA(opJid, `⚠️ *${pushName || jid}* pediu ajuste no pedido *${orderNumber ?? ""}*. O chatbot está em contato — pedido voltou para triagem.`)
      }).catch(() => {})
      return
    }

    replyWA(jid, `Seu pedido *${orderNumber ?? ""}* aguarda confirmação. Responde *SIM* para confirmar ou *NÃO* para ajustar.`)
    return
  }

  // ── cliente sinaliza que pedido está pronto para confirmar (triagem) ────────
  if (state === "triagem") {
    const isConfirmar = lower === "pronto" || lower === "ok" || lower === "confirmar" ||
      ["tá bom", "ta bom", "tudo certo", "pode confirmar", "pode ir", "fechado",
       "tá certo", "ta certo", "isso mesmo", "está certo", "pode mandar"].some(k => lower.includes(k))

    if (isConfirmar) {
      const { rows: openConf } = await pool.query(
        `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
         ORDER BY created_at DESC LIMIT 1`,
        [contactId]
      )
      if (!openConf[0]) {
        replyWA(jid, "Não encontrei pedido aberto. Me manda o que você quer pedir!")
        return
      }
      const confOrderId  = openConf[0].id  as number
      const confOrderNum = openConf[0].number as string

      const { rows: confItems } = await pool.query(
        `SELECT product_name, color, size, qty::int AS qty FROM order_items WHERE order_id = $1 ORDER BY id`,
        [confOrderId]
      )
      if (!confItems.length) {
        replyWA(jid, "Seu pedido está vazio. Me manda os itens primeiro!")
        return
      }

      const confLines = (confItems as { product_name: string; color: string; size: string; qty: number }[]).map((it, idx) => {
        const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
        return `${idx + 1}. ${desc} · *${it.qty} un*`
      })

      await pool.query(`UPDATE orders SET status = 'confirmando' WHERE id = $1`, [confOrderId])
      await pool.query(
        `INSERT INTO order_events (order_id, status, actor, note)
         VALUES ($1, 'confirmando', 'chatbot', 'Cliente sinalizou pedido pronto para separação')`,
        [confOrderId]
      )
      await setState(contactId, "confirmando", { orderId: confOrderId, orderNumber: confOrderNum })

      const totalConf = await pool.query(
        `SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) AS total FROM order_items WHERE order_id = $1`,
        [confOrderId]
      )
      const totalVal = Number(totalConf.rows[0]?.total ?? 0)
      const totalStr = totalVal > 0 ? `\n\n💰 *Total: R$ ${totalVal.toFixed(2).replace(".", ",")}*` : ""
      replyWA(jid, `Ótimo! Seu pedido *${confOrderNum}* ficou assim:\n\n${confLines.join("\n")}${totalStr}\n\nResponde *SIM* para confirmar ou *NÃO* para ajustar.`)
      return
    }
  }

  // ── pergunta de prazo → sinaliza para atendimento manual ──────────────────
  if (state === "em_separacao" || state === "pronto") {
    const prazoKw = ["quando", "quanto tempo", "cadê", "cade", "terminou",
      "entrega", "retirada", "posso buscar", "posso retirar",
      "ta pronto", "tá pronto", "ficou pronto", "status", "meu pedido"]
    if (prazoKw.some(k => lower.includes(k))) {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'prazo', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      replyWA(jid, "Vou acionar a equipe agora! ⏰")
      return
    }
  }

  const intent = await classifyIntent(text)

  // ── remover item do pedido em triagem ──────────────────────────────────────
  if (intent === "remover" && state === "triagem") {
    const { rows: openRem } = await pool.query(
      `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
       ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )
    if (!openRem[0]) {
      replyWA(jid, "Não tem pedido aberto pra editar.")
      return
    }
    const remOrderId  = openRem[0].id as number
    const remOrderNum = openRem[0].number as string

    const { rows: remItems } = await pool.query(
      `SELECT id, product_name, color, size, qty::int AS qty FROM order_items WHERE order_id = $1 ORDER BY id`,
      [remOrderId]
    )
    if (!remItems.length) {
      replyWA(jid, "Pedido está vazio.")
      return
    }

    // Tenta referência numérica: "remove o 2", "tira o item 3"
    const numRef = text.match(/\b([1-9])\b/)
    const byIndex = numRef ? (remItems[parseInt(numRef[1]) - 1] ?? null) : null

    // Tenta match por nome de produto
    let byName: typeof remItems[0] | null = null
    if (!byIndex) {
      let pText: import("@/lib/ai/parseOrder").ParsedItem[] = []
      try { pText = await parseOrder(text) } catch { /* */ }
      if (pText.length) {
        byName = remItems.find(it =>
          pText.some(p => p.productName && it.product_name.toLowerCase().includes(p.productName.toLowerCase().split(" ")[0]))
        ) ?? null
      }
    }

    const toRemove = byIndex ?? byName
    if (toRemove) {
      await pool.query(`DELETE FROM order_items WHERE id = $1`, [toRemove.id])
      await pool.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [remOrderId]
      )
      const { rows: remCount } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = $1`, [remOrderId]
      )
      if (Number(remCount[0].cnt) === 0) {
        await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [remOrderId])
        await pool.query(
          `INSERT INTO order_events (order_id, status, actor, note)
           VALUES ($1, 'cancelado', 'chatbot', 'Pedido cancelado — todos os itens removidos')`,
          [remOrderId]
        )
        await setState(contactId, "idle")
        replyWA(jid, `Removido. Pedido *${remOrderNum}* ficou vazio e foi cancelado. Me chama quando precisar!`)
      } else {
        const desc = [toRemove.product_name, toRemove.color, toRemove.size].filter(Boolean).join(" ")
        replyWA(jid, `✅ Removido: *${toRemove.qty}x ${desc}* do pedido *${remOrderNum}*.`)
      }
    } else {
      const itemList = remItems.map((it, i) =>
        `${i + 1}. ${[it.product_name, it.color, it.size].filter(Boolean).join(" ")} · *${it.qty} un*`
      ).join("\n")
      replyWA(jid, `Qual item quer remover do *${remOrderNum}*?\n\n${itemList}\n\nEx: _tira o moletom preto_ ou _remove o item 1_`)
    }
    return
  }

  // ── alterar item do pedido em triagem ──────────────────────────────────────
  if (intent === "alterar" && state === "triagem") {
    const { rows: openAlt } = await pool.query(
      `SELECT id, number FROM orders WHERE contact_id = $1 AND status = 'triagem'
       ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )
    if (!openAlt[0]) {
      replyWA(jid, "Não tem pedido aberto pra alterar.")
      return
    }
    const altOrderId  = openAlt[0].id as number
    const altOrderNum = openAlt[0].number as string

    const { rows: altItems } = await pool.query(
      `SELECT id, product_name, color, size, qty::int AS qty FROM order_items WHERE order_id = $1 ORDER BY id`,
      [altOrderId]
    )

    let altParsed: import("@/lib/ai/parseOrder").ParsedItem[] = []
    try { altParsed = await parseOrder(text) } catch { /* */ }

    if (!altParsed.length) {
      const itemList = altItems.map((it, i) =>
        `${i + 1}. ${[it.product_name, it.color, it.size].filter(Boolean).join(" ")} · *${it.qty} un*`
      ).join("\n")
      replyWA(jid, `O que quer alterar no pedido *${altOrderNum}*?\n\n${itemList}\n\nEx: _muda pra 15 o moletom preto P_`)
      return
    }

    const altUpdated: string[] = []
    for (const p of altParsed) {
      if (!p.productName) continue
      const match = altItems.find(it =>
        it.product_name.toLowerCase().includes(p.productName.toLowerCase().split(" ")[0])
      )
      if (match) {
        await pool.query(
          `UPDATE order_items
           SET qty   = $1,
               color = COALESCE(NULLIF($2,''), color),
               size  = COALESCE(NULLIF($3,''), size)
           WHERE id  = $4`,
          [p.qty, p.color ?? "", p.size ?? "", match.id]
        )
        const desc = [p.productName, p.color ?? match.color, p.size ?? match.size].filter(Boolean).join(" ")
        altUpdated.push(`• ${desc} · *${p.qty} un*`)
      }
    }

    if (altUpdated.length) {
      await pool.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [altOrderId]
      )
      replyWA(jid, `✅ Pedido *${altOrderNum}* atualizado:\n\n${altUpdated.join("\n")}`)
    } else {
      const itemList = altItems.map((it, i) =>
        `${i + 1}. ${[it.product_name, it.color, it.size].filter(Boolean).join(" ")} · *${it.qty} un*`
      ).join("\n")
      replyWA(jid, `Não consegui identificar o que mudar. Pedido atual:\n\n${itemList}\n\nMe fala o que mudou.`)
    }
    return
  }

  if (intent === "pedido") {
    if (state === "triagem") {
      // Adiciona ao pedido existente em triagem — não cria novo (salvo se expirado)
      const { rows: openOrders } = await pool.query(
        `SELECT id, number, created_at FROM orders WHERE contact_id = $1 AND status = 'triagem' ORDER BY created_at DESC LIMIT 1`,
        [contactId]
      )
      if (openOrders[0]) {
        const ageMs = Date.now() - new Date(openOrders[0].created_at).getTime()
        const expired = ageMs > 2 * 60 * 60 * 1000

        if (expired) {
          // Cancela silenciosamente e deixa cair pro bloco de criação abaixo
          await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [openOrders[0].id])
          await pool.query(`
            INSERT INTO order_events (order_id, status, actor, note)
            VALUES ($1, 'cancelado', 'sistema', 'Expirado automaticamente após 2h em triagem')
          `, [openOrders[0].id])
        } else {
          let parsed
          try { parsed = await parseOrder(text) } catch {
            replyWA(jid, "Não entendi. Me passa: _10 moletom preto P_")
            return
          }
          if (!parsed.length) {
            replyWA(jid, "Não consegui identificar os itens. Me manda: _10 moletom preto P_")
            return
          }
          const matched = await matchVariants(parsed)
          for (const item of matched) {
            await pool.query(`
              INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [openOrders[0].id, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
          }
          const lines = matched.map(m => `• ${[m.productName, m.color, m.size].filter(Boolean).join(" ")} · *${m.qty} un*`)
          replyWA(jid, `✅ Anotado! Adicionei ao pedido *${openOrders[0].number}*:\n\n${lines.join("\n")}`)
          return
        }
      }
    }
    // em_separacao ou pronto → novo pedido vinculado ao anterior
    const parentOrderId = stateData?.orderId as number | undefined
    const _raceOk = await setStateIf(contactId, "coletando", { rawMessages: [text] }, ["triagem", "em_separacao", "pronto"])
    if (!_raceOk) return
    if (parentOrderId) {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'novo_pedido', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
    }
    await createOrderDirect(jid, contactId, [text], null, undefined, chatbotDtfEnabled, globalSettings, parentOrderId)
    return
  }

  if (intent === "dtf") {
    replyWA(jid, "Pode mandar o arquivo de DTF direto aqui! 🖨️")
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

  if (intent === "status") {
    const res = await pool.query(`
      SELECT number, status FROM orders
      WHERE contact_id = $1
      ORDER BY created_at DESC LIMIT 1
    `, [contactId])
    if (res.rows[0]) {
      replyWA(jid, `Seu pedido *${res.rows[0].number}* está: *${statusLabel(res.rows[0].status)}*`)
    }
    return
  }

  const firstName = pushName.split(" ")[0]
  replyWA(jid, `Oi ${firstName}! Seu pedido está em andamento. Qualquer dúvida é só chamar.`)
}

// ─── Reserva: resposta do cliente ao "posso separar o restante?" ─────────────

async function handleAguardandoSeparacaoResposta(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower   = text.toLowerCase().trim()
  const isSim   = ["sim", "s", "yes", "pode", "claro", "manda", "vai", "ok", "pode sim"].some(w => lower === w || lower.startsWith(w + " "))
  const isNao   = ["não", "nao", "n", "no", "nao quero", "não quero"].includes(lower)

  const orderId     = stateData.orderId     as number
  const orderNumber = stateData.orderNumber as string
  const missingItems= (stateData.missingItems as Array<{ variantId: string | null; name: string; qty: number; withReserva?: boolean }>) ?? []
  const availableItemIds = (stateData.availableItemIds as number[]) ?? []
  const allMissing  = Boolean(stateData.allMissing)

  if (isSim) {
    if (allMissing) {
      // Todos os itens em produção — cria reservas, mantém pedido em triagem
      for (const mi of missingItems) {
        if (mi.variantId) {
          await pool.query(`
            INSERT INTO product_reservations (contact_id, variant_id, qty, prod_order_id, order_id)
            VALUES ($1, $2, $3,
              (SELECT po.id FROM prod_orders po JOIN prod_order_items poi ON poi.order_id = po.id
               JOIN product_variants pv ON pv.product_id = poi.product_id
               WHERE po.status = 'em_andamento' AND pv.id = $2 LIMIT 1),
              $4)
          `, [contactId, mi.variantId, mi.qty, orderId])
        }
      }
      await setState(contactId, "triagem", { orderId, orderNumber })
      replyWA(jid, `✅ Reserva feita! Assim que ${missingItems.length === 1 ? "o item chegar" : "os itens chegarem"} te avisamos aqui.`)
      return
    }

    // Parcial: remove itens faltantes, avança para separação
    if (availableItemIds.length > 0) {
      const cli6 = await pool.connect()
      try {
        await cli6.query("BEGIN")
        await cli6.query(`SELECT pg_advisory_xact_lock($1)`, [contactId])
        await cli6.query(`
          DELETE FROM order_items WHERE order_id = $1 AND id != ALL($2::int[])
        `, [orderId, availableItemIds])
        await cli6.query(
          `UPDATE orders SET total_value = (
             SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
           ), is_partial = true, status = 'em_separacao', needs_print = true WHERE id = $1`,
          [orderId]
        )
        await cli6.query(`
          INSERT INTO order_events (order_id, status, actor, note)
          VALUES ($1, 'em_separacao', 'chatbot', 'Cliente confirmou separação parcial')
        `, [orderId])
        const { rows: items } = await cli6.query(
          `SELECT variant_id, qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`, [orderId]
        )
        for (const item of items) {
          await cli6.query(`
            INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
            VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)
          `, [item.variant_id, item.qty, `Pedido ${orderNumber}`])
        }
        await cli6.query("COMMIT")
      } catch (e) {
        await cli6.query("ROLLBACK").catch(() => {})
        console.error("[aguardandoSeparacao] transação falhou:", e)
        throw e
      } finally {
        cli6.release()
      }
    }

    // Cria reservas para itens com prod_order ativo
    for (const mi of missingItems) {
      if (mi.variantId && mi.withReserva) {
        await pool.query(`
          INSERT INTO product_reservations (contact_id, variant_id, qty, prod_order_id, order_id)
          VALUES ($1, $2, $3,
            (SELECT po.id FROM prod_orders po JOIN prod_order_items poi ON poi.order_id = po.id
             JOIN product_variants pv ON pv.product_id = poi.product_id
             WHERE po.status = 'em_andamento' AND pv.id = $2 LIMIT 1),
            $4)
        `, [contactId, mi.variantId, mi.qty, orderId])
      }
    }

    const hasReserva = missingItems.some(m => m.withReserva)
    await setState(contactId, "em_separacao", { orderId, orderNumber })

    let msg = `✅ Perfeito! Já estamos separando o que tem.`
    if (hasReserva) msg += ` E já anotei a reserva dos itens em produção — te aviso quando chegar!`
    msg += ` Avisamos quando pronto para retirada!`
    replyWA(jid, msg)
    return
  }

  if (isNao) {
    await setState(contactId, "aguardando_cancelamento_resposta", { orderId, orderNumber })
    replyWA(jid, `Sem problema! Deseja cancelar o pedido *${orderNumber}*? Responde *SIM* ou *NÃO*.`)
    return
  }

  // Não entendeu
  replyWA(jid, `Responde *SIM* para separar o que tem ou *NÃO* se preferir aguardar.`)
}

async function handleAguardandoCancelamentoResposta(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower = text.toLowerCase().trim()
  const isSim = ["sim", "s", "yes", "pode cancelar", "cancela"].some(w => lower === w || lower.startsWith(w + " "))
  const isNao = ["não", "nao", "n", "no"].includes(lower)

  const orderId     = stateData.orderId     as number
  const orderNumber = stateData.orderNumber as string

  if (isSim) {
    await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [orderId])
    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'cancelado', 'chatbot', 'Cliente cancelou via WhatsApp')
    `, [orderId])
    await setState(contactId, "idle")
    replyWA(jid, `Ok, pedido *${orderNumber}* cancelado. Quando precisar é só chamar!`)
    return
  }

  if (isNao) {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    await setState(contactId, "triagem", { orderId, orderNumber })
    replyWA(jid, `Certo! Pedido *${orderNumber}* continua aguardando. Nossa equipe entra em contato.`)
    return
  }

  replyWA(jid, `Responde *SIM* para cancelar ou *NÃO* para manter o pedido.`)
}

async function handleAguardandoReservaResposta(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string
) {
  const lower = text.toLowerCase().trim()
  const isSim = ["sim", "s", "yes", "quero", "preciso", "pode", "manda"].some(w => lower === w || lower.startsWith(w + " "))
  const isNao = ["não", "nao", "n", "no", "nao preciso", "não preciso", "cancelar", "cancela"].some(w => lower === w || lower.startsWith(w + " "))

  const reservationId = stateData.reservationId as number
  const variantId     = stateData.variantId     as string
  const variantName   = stateData.variantName   as string
  const qty           = stateData.qty           as number

  if (isSim) {
    // Verifica saldo disponível (descontando reservas notificadas de outros clientes)
    const { rows: stockRows } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN sm.type = 'in' THEN sm.quantity ELSE -sm.quantity END), 0) AS balance,
        COALESCE(
          (SELECT SUM(qty) FROM product_reservations
           WHERE variant_id = $1 AND status = 'notified' AND id != $2),
          0
        ) AS other_notified
      FROM stock_movements sm
      WHERE sm.variant_id = $1
    `, [variantId, reservationId])

    const available = Math.max(
      0,
      Number(stockRows[0]?.balance ?? 0) - Number(stockRows[0]?.other_notified ?? 0)
    )

    if (available < qty) {
      // Estoque insuficiente — cancela e avisa
      await pool.query(`UPDATE product_reservations SET status = 'cancelled' WHERE id = $1`, [reservationId])
      await setState(contactId, "idle")
      replyWA(jid, `😔 Lamentamos! As unidades de *${variantName}* foram reservadas por outros clientes. Assim que tiver disponível novamente, te avisamos!`)
      return
    }

    // Confirma reserva → cria novo pedido
    const numRes  = await pool.query("SELECT nextval('order_number_seq') AS n")
    const number  = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`
    const { rows: vRows } = await pool.query(
      `SELECT sale_price FROM product_variants WHERE id = $1`, [variantId]
    )
    const unitPrice  = vRows[0]?.sale_price ? Number(vRows[0].sale_price) : null
    const totalValue = unitPrice ? unitPrice * qty : null

    const { rows: [newOrder] } = await pool.query(`
      INSERT INTO orders (number, contact_id, status, total_value, source, needs_print)
      VALUES ($1, $2, 'em_separacao', $3, 'whatsapp', true)
      RETURNING id, number
    `, [number, contactId, totalValue])

    await pool.query(`
      INSERT INTO order_items (order_id, product_name, color, size, variant_id, qty, unit_price)
      SELECT $1, p.name, pv.color, pv.size, pv.id, $2, pv.sale_price
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $3
    `, [newOrder.id, qty, variantId])

    await pool.query(`
      INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
      VALUES ($1, 'out', $2, 'venda', 'chatbot', $3)
    `, [variantId, qty, `Pedido ${number} (reserva)`])

    await pool.query(`UPDATE product_reservations SET status = 'confirmed' WHERE id = $1`, [reservationId])

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'em_separacao', 'chatbot', 'Pedido criado a partir de reserva confirmada')
    `, [newOrder.id])

    await setState(contactId, "em_separacao", { orderId: newOrder.id, orderNumber: number })
    replyWA(jid, `✅ Perfeito! Separando as *${qty} ${variantName}* para você. Pedido *${number}* em separação — avisamos quando pronto!`)
    return
  }

  if (isNao) {
    await pool.query(`UPDATE product_reservations SET status = 'cancelled' WHERE id = $1`, [reservationId])

    // Notifica o próximo da fila imediatamente (sem esperar o cron)
    const { rows: nextRes } = await pool.query(`
      SELECT pr.id, pr.contact_id, pr.qty, pv.color, pv.size, p.name AS product_name,
             COALESCE(c.phone_jid, c.jid) AS send_jid
      FROM product_reservations pr
      JOIN product_variants pv ON pv.id = pr.variant_id
      JOIN products p          ON p.id  = pv.product_id
      JOIN wa_contacts c       ON c.id  = pr.contact_id
      WHERE pr.variant_id = $1 AND pr.status = 'pending'
      ORDER BY pr.created_at ASC LIMIT 1
    `, [variantId])

    if (nextRes[0]?.send_jid) {
      const next = nextRes[0]
      const { rows: cfgRows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'reserva_expiry_hours'`)
      const expiryHours = Number(cfgRows[0]?.value ?? 4)
      const expiresAt   = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()
      const nextName    = [next.product_name, next.color, next.size].filter(Boolean).join(" ")

      await pool.query(`
        UPDATE product_reservations SET status = 'notified', notified_at = NOW(), expires_at = $1
        WHERE id = $2
      `, [expiresAt, next.id])

      await pool.query(`
        UPDATE wa_contacts SET state = 'aguardando_reserva_resposta', state_data = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify({ reservationId: next.id, variantId, variantName: nextName, qty: next.qty }), next.contact_id])

      sendWhatsApp(next.send_jid, `🎉 Boa notícia! A *${nextName}* que você reservou chegou!\n\nAinda precisa? Responde *SIM* ou *NÃO*.`).catch(() => {})
    }

    await setState(contactId, "idle")
    replyWA(jid, `Tudo bem! Reserva cancelada. Quando precisar é só chamar.`)
    return
  }

  replyWA(jid, `A *${variantName}* que você reservou chegou! Ainda precisa? Responde *SIM* ou *NÃO*.`)
}

// ─── Silent order create (chatbot mudo + pedidos_auto on) ───────────────────

async function trySilentOrderCreate(contactId: number, text: string) {
  try {
    // Pass last ordered product as context so AI can infer product when not specified
    let productHint: string | null = null
    try {
      const res = await pool.query(`
        SELECT oi.product_name
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.contact_id = $1 AND o.status != 'cancelado'
        ORDER BY o.created_at DESC LIMIT 1
      `, [contactId])
      if (res.rows[0]?.product_name) {
        productHint = `Último produto pedido por este cliente: "${res.rows[0].product_name}". Se a mensagem tiver qty+cor+tamanho sem produto explícito, use este produto.`
      }
    } catch { /* no history */ }

    const { intent, items: preParsed } = await classifyAndParse(text, productHint)
    if (intent !== "pedido" || !preParsed || preParsed.length === 0) return

    const matched = await matchVariants(preParsed)
    if (matched.length === 0) return

    // Dedup: acrescenta na triagem aberta se existir
    const { rows: openTriagemSilent } = await pool.query(
      `SELECT id FROM orders WHERE contact_id = $1 AND status = 'triagem'
       AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    )
    if (openTriagemSilent[0]) {
      const existId = openTriagemSilent[0].id as number
      for (const item of matched) {
        await pool.query(
          `INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [existId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice]
        )
      }
      await pool.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [existId]
      )
      return
    }

    const totalValue = matched.reduce((sum, m) => sum + (m.unitPrice ?? 0) * m.qty, 0)

    const numRes = await pool.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    const orderRes = await pool.query(`
      INSERT INTO orders (number, contact_id, status, total_value, source)
      VALUES ($1, $2, 'triagem', $3, 'whatsapp')
      RETURNING id
    `, [number, contactId, totalValue > 0 ? totalValue : null])

    const orderId = orderRes.rows[0].id

    for (const item of matched) {
      await pool.query(`
        INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [orderId, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
    }

    await pool.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'triagem', 'chatbot', 'Pedido detectado automaticamente — modo manual ativo')
    `, [orderId])
  } catch (e) { console.error("[trySilentOrderCreate] falhou:", e) }
}

// ─── DTF media handler ───────────────────────────────────────────────────────

async function handleDtfMedia(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
) {
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

    // Auto-link the triggering wa_message to this order
    const { rows: msgRows } = await cli8.query(`
      SELECT id, file_name FROM wa_messages
      WHERE contact_id = $1 AND media_type IN ('document', 'image') AND direction = 'in'
        AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY id DESC LIMIT 1
    `, [contactId])
    if (msgRows[0]) {
      await cli8.query(`
        INSERT INTO dtf_order_attachments (pedido_id, wa_message_id, filename)
        VALUES ($1, $2, $3)
      `, [pedidoId, msgRows[0].id, msgRows[0].file_name]).catch(() => {})
    }

    await cli8.query(
      `UPDATE wa_contacts
       SET needs_attention = true, lifecycle_state = 'active',
           lifecycle_updated_at = NOW(), last_order_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    )

    await cli8.query("COMMIT")

    await setState(contactId, "dtf_coletando_arquivos", { pedidoId, pedidoNumber: number })
    replyWA(jid, `📎 Arte *${number}* recebida! Tem mais arquivos pra adicionar?\nManda agora ou responda *pronto* para finalizar.`)
  } catch (e) {
    await cli8.query("ROLLBACK").catch(() => {})
    console.error("[handleDtfMedia] falhou — migration dtf_pedidos/dtf_order_number_seq não rodou?", e)
  } finally {
    cli8.release()
  }
}

async function addFileToDtfPedido(jid: string, contactId: number, pedidoId: number, msg: unknown) {
  try {
    const { rows: msgRows } = await pool.query(`
      SELECT id, file_name FROM wa_messages
      WHERE contact_id = $1 AND media_type IN ('document', 'image') AND direction = 'in'
        AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY id DESC LIMIT 1
    `, [contactId])

    if (msgRows[0]) {
      await pool.query(`
        INSERT INTO dtf_order_attachments (pedido_id, wa_message_id, filename)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [pedidoId, msgRows[0].id, msgRows[0].file_name])
    }

    void msg
    replyWA(jid, `📎 Arquivo adicionado! Mais algum ou responda *pronto* para finalizar.`)
  } catch (e) {
    console.error("[addFileToDtfPedido]", e)
  }
}
