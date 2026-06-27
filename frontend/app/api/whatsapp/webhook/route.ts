import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { classifyIntent } from "@/lib/ai/classifyIntent"
import { classifyAndParse } from "@/lib/ai/classifyAndParse"
import { classifyMedia } from "@/lib/ai/classifyMedia"
import { downloadEvolutionMedia, uploadToBlob, classifyMediaCategory, type MediaCategory } from "@/lib/whatsapp/media"
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

// Downloads full media, uploads to Vercel Blob, updates wa_messages — runs fire-and-forget
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
      console.error("[saveMedia] downloadEvolutionMedia returned null — messageId:", messageId, "mediaType:", mediaType)
      if (messageId) {
        await pool.query(
          `UPDATE wa_messages SET media_failed = TRUE WHERE message_id = $1`,
          [messageId]
        ).catch(() => {})
      }
      return
    }

    const category: MediaCategory = classifyMediaCategory(mediaType, media.mimeType, contactState)

    const folderMap: Record<MediaCategory, "dtf" | "pix" | "media" | "audio" | "docs"> = {
      foto:      "media",
      video:     "media",
      audio:     "audio",
      pix:       "pix",
      dtf:       "dtf",
      documento: "docs",
      sticker:   "media",
    }

    const url = await uploadToBlob(media.base64, media.mimeType, media.filename, folderMap[category])
    if (!url) return

    if (messageId) {
      await pool.query(
        `UPDATE wa_messages SET media_url = $1, media_category = $2 WHERE message_id = $3`,
        [url, category, messageId]
      ).catch(() => {})
    } else {
      // Fallback: update most recent media message without url from this contact
      await pool.query(
        `UPDATE wa_messages SET media_url = $1, media_category = $2
         WHERE id = (SELECT id FROM wa_messages WHERE contact_id = $3 AND media_type IS NOT NULL AND media_url IS NULL ORDER BY created_at DESC LIMIT 1)`,
        [url, category, contactId]
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

    // contacts.upsert fires the entire phone book on connection — ignore it.
    if (event === "contacts.upsert") {
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
        name      = CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name ~ '^[0-9]+$' OR EXCLUDED.name = '' THEN wa_contacts.name ELSE EXCLUDED.name END,
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
  return /^\d+$/.test(pushName.trim())
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

async function recordOffer(contactId: number, offerType: string) {
  try {
    await pool.query(
      `INSERT INTO wa_contact_offers (contact_id, offer_type) VALUES ($1, $2)`,
      [contactId, offerType]
    )
  } catch (e) { console.error("[recordOffer] falhou — migration wa_contact_offers não rodou?", e) }
}

async function wasOfferedRecently(contactId: number, offerType: string, days = 7): Promise<boolean> {
  try {
    const { rows } = await pool.query(`
      SELECT 1 FROM wa_contact_offers
      WHERE contact_id = $1 AND offer_type = $2
        AND offered_at > NOW() - ($3 || ' days')::INTERVAL
      LIMIT 1
    `, [contactId, offerType, days])
    return rows.length > 0
  } catch {
    return false
  }
}

async function getTopProduct(contactId: number): Promise<string | null> {
  const { rows } = await pool.query(`
    SELECT LOWER(oi.product_name) AS product_name, COUNT(*) AS cnt
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.contact_id = $1 AND o.status = 'concluido'
    GROUP BY LOWER(oi.product_name)
    ORDER BY cnt DESC
    LIMIT 1
  `, [contactId])
  return rows[0]?.product_name ?? null
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

const DTF_TIPS = `Pra preparar seu arquivo, use essas ferramentas gratuitas:

• *Remover fundo* → remove.bg
• *Vetorizar* → vectorizer.ai
• *Montar o metro com encaixe* → pvty.com.br _(economiza muito material)_

PNG ou JPG com fundo transparente, resolução mínima 150dpi, largura máx. *57cm*.

Quando estiver pronto é só mandar aqui que eu registro na hora! 🖨️`

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

  if (service === "dtf" && s[`${p}_ativo`] === "false") return { available: false, reason: "desativado" }

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

// ─── menu ────────────────────────────────────────────────────────────────────

async function sendMenuMessage(jid: string, pushName: string) {
  const firstName = pushName.split(" ")[0]
  const greeting  = getGreeting()

  const { rows: cfg } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key IN ('dtf_ativo', 'produto_ativo')`
  )
  const s: Record<string, string> = {}
  for (const r of cfg) s[r.key] = r.value

  const temProduto = s.produto_ativo !== "false" && await hasProdutoDisponivel()
  const temDtf     = s.dtf_ativo !== "false"

  const opt1 = temProduto ? "1️⃣ Fazer um pedido" : "1️⃣ Fazer um pedido (indisponível)"
  const opt2 = temDtf     ? "2️⃣ Impressão DTF"   : "2️⃣ Impressão DTF (indisponível)"

  replyWA(jid, `${greeting}, ${firstName}! 👋\n\nSou o atendimento da *SM Confecções* — atacado de roupas e impressão DTF.\n\nComo posso te ajudar?\n${opt1}\n${opt2}\n3️⃣ Falar com atendimento`)
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
    const url = await uploadToBlob(media.base64, media.mimeType, media.filename, "pix")
    if (order) {
      await pool.query(`
        INSERT INTO order_attachments (order_id, type, blob_url, filename, mime_type)
        VALUES ($1, 'pix_comprovante', $2, $3, $4)
      `, [order.id, url, media.filename, media.mimeType])
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
    if (["dtf_verificando", "dtf_sem_arquivo", "dtf_coletando", "cross_sell_dtf", "cross_sell_produto", "aguardando_menu"].includes(state)) {
      await setState(contactId, "idle")
      replyWA(jid, "Ok! Me chama quando precisar. 😊")
      return
    }

    const order = await getMostRecentOrder(contactId)

    if (order?.status === "pronto") {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, updated_at = NOW() WHERE id = $1`,
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
        `UPDATE wa_contacts SET needs_attention = true, state = 'idle', state_data = '{}', updated_at = NOW() WHERE id = $1`,
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
    await sendMenuMessage(jid, pushName)
    await setState(contactId, "aguardando_menu")
    return
  }

  switch (state) {
    case "idle":
      await handleIdle(jid, contactId, text, lifecycle, pushName, chatbotProdutoEnabled, chatbotDtfEnabled, chatbotObs, lastOrderAt, produtoStatus, dtfStatus, globalSettings)
      break

    case "aguardando_menu":
      await handleMenuSelection(jid, contactId, text, pushName, chatbotProdutoEnabled, chatbotDtfEnabled, produtoStatus, dtfStatus, globalSettings)
      break

    case "coletando":
      await handleColetando(jid, contactId, stateData, text, chatbotDtfEnabled)
      break

    case "aguardando_cliente_1":
      await handleAguardandoCliente1(jid, contactId, stateData, text, chatbotDtfEnabled)
      break

    case "dtf_verificando":
      await handleDtfVerificando(jid, contactId, text, chatbotDtfEnabled)
      break

    case "dtf_sem_arquivo":
      await handleDtfSemArquivo(jid, contactId, text)
      break

    case "dtf_coletando":
      replyWA(jid, "Pode mandar sua arte aqui! 🖨️")
      break

    case "cross_sell_dtf":
      await handleCrossSellDtf(jid, contactId, stateData, text, chatbotDtfEnabled, dtfStatus)
      break

    case "cross_sell_produto":
      await handleCrossSellProduto(jid, contactId, text, chatbotProdutoEnabled, produtoStatus)
      break

    case "aguardando_nome":
      await handleAguardandoNome(jid, contactId, text)
      break

    default:
      // triagem / confirmando / em_separacao / pronto — pedido ativo
      await handleActiveOrder(jid, contactId, state, stateData, text, pushName, chatbotDtfEnabled)
  }
}

async function handleAguardandoNome(jid: string, contactId: number, text: string) {
  const nome = text.trim().replace(/[^a-zA-ZÀ-ÿ\s]/g, "").trim()
  if (!nome || nome.length < 2) {
    replyWA(jid, "Pode me passar seu nome pra eu te atender melhor?")
    return
  }
  await pool.query("UPDATE wa_contacts SET name = $1, updated_at = NOW() WHERE id = $2", [nome, contactId])
  await sendMenuMessage(jid, nome)
  await setState(contactId, "aguardando_menu")
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
  const firstName = pushName.split(" ")[0]
  void lifecycle

  // Returning client — simplified direct flow
  if (lastOrderAt) {
    const { intent, items: preParsed } = await classifyAndParse(text, chatbotObs)

    if (intent === "pedido") {
      if (!chatbotProdutoEnabled || !produtoStatus.available) {
        replyWA(jid, buildUnavailableMsg("produto", produtoStatus, dtfStatus, globalSettings))
        if (!produtoStatus.available && dtfStatus.available) await setState(contactId, "cross_sell_dtf")
        return
      }
      const _raceOk = await setStateIf(contactId, "coletando", { rawMessages: [text], chatbotObs }, ["idle"])
      if (!_raceOk) return
      await createOrderDirect(jid, contactId, [text], chatbotObs, preParsed, chatbotDtfEnabled)

    } else if (intent === "dtf") {
      if (!chatbotDtfEnabled || !dtfStatus.available) {
        replyWA(jid, buildUnavailableMsg("dtf", dtfStatus, produtoStatus, globalSettings))
        if (!dtfStatus.available && produtoStatus.available) await setState(contactId, "cross_sell_produto")
        return
      }
      await tagContact(contactId, "interessado_dtf")
      await setState(contactId, "dtf_verificando")
      replyWA(jid, "Você já tem o arquivo pronto pra impressão?")

    } else if (intent === "preco") {
      await sendCatalog(jid, contactId)

    } else if (intent === "variacao") {
      await handleVariacao(jid, contactId, text)

    } else if (intent === "status") {
      const { rows: dtfActive } = await pool.query(
        `SELECT number FROM dtf_pedidos WHERE contact_id = $1 AND status = 'em_producao' LIMIT 1`,
        [contactId]
      )
      if (dtfActive[0]) {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, updated_at = NOW() WHERE id = $1`,
          [contactId]
        )
        replyWA(jid, "Vou acionar a equipe agora!")
      } else {
        const res = await pool.query(`
          SELECT number, status FROM orders
          WHERE contact_id = $1
          ORDER BY created_at DESC LIMIT 1
        `, [contactId])
        if (res.rows[0]) {
          replyWA(jid, `Seu último pedido *${res.rows[0].number}* está: *${statusLabel(res.rows[0].status)}*`)
        } else {
          await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
          replyWA(jid, `${getGreeting()}, ${firstName}! Me passa o pedido.`)
        }
      }

    } else {
      // saudacao ou outro — smart greeting com produto mais pedido
      const topProduct = await getTopProduct(contactId)
      const greeting = getGreeting()
      if (topProduct) {
        await setState(contactId, "coletando", { rawMessages: [], chatbotObs, smartGreeted: true })
        replyWA(jid, `${greeting}, ${firstName}! Vai precisar de ${topProduct} hoje? Manda o pedido que a gente separa pra você.`)
      } else {
        await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
        replyWA(jid, `${greeting}, ${firstName}! Me passa o pedido.`)
      }
    }
    return
  }

  // New client — ask name if missing
  if (semNome(pushName)) {
    await setState(contactId, "aguardando_nome")
    replyWA(jid, "Oi! Como posso te chamar?")
    return
  }
  // Client knows what they want → skip menu
  const { intent: newIntent, items: newParsed } = await classifyAndParse(text, chatbotObs).catch(() => ({ intent: "outro" as const, items: [] }))
  if (newIntent === "pedido" && chatbotProdutoEnabled && produtoStatus.available) {
    const ok = await setStateIf(contactId, "coletando", { rawMessages: [text], chatbotObs }, ["idle"])
    if (ok) { await createOrderDirect(jid, contactId, [text], chatbotObs, newParsed, chatbotDtfEnabled); return }
  }
  if (newIntent === "dtf" && chatbotDtfEnabled && dtfStatus.available) {
    await tagContact(contactId, "interessado_dtf")
    await setState(contactId, "dtf_verificando")
    replyWA(jid, "Você já tem o arquivo pronto pra impressão? (PNG, JPG ou PDF — largura máx. 57cm)")
    return
  }
  if (newIntent === "variacao") {
    await handleVariacao(jid, contactId, text)
    await setState(contactId, "aguardando_menu")
    return
  }
  if (newIntent === "preco") {
    await sendCatalog(jid, contactId)
    await setState(contactId, "aguardando_menu")
    return
  }
  await sendMenuMessage(jid, pushName)
  await setState(contactId, "aguardando_menu")
}

async function handleMenuSelection(
  jid: string,
  contactId: number,
  text: string,
  pushName: string,
  chatbotProdutoEnabled = true,
  chatbotDtfEnabled = false,
  produtoStatus: ServiceStatus = { available: true, reason: null },
  dtfStatus: ServiceStatus     = { available: true, reason: null },
  globalSettings: Record<string, string> = {}
) {
  const lower = text.toLowerCase().trim()

  // Detecta intenção antes de checar 1/2/3 — responde perguntas sem forçar re-seleção
  if (!["1","2","3","produto","produtos","fazer um pedido","pedido","dtf","impressão dtf",
        "impressao dtf","impressao","impressão","atendimento","atendente","humano","pessoa"].includes(lower)) {
    const menuMsgIntent = await classifyIntent(text).catch(() => "outro" as const)
    if (menuMsgIntent === "variacao") {
      await handleVariacao(jid, contactId, text)
      return
    }
    if (menuMsgIntent === "preco") {
      await sendCatalog(jid, contactId)
      return
    }
  }

  const isProduto     = ["1", "produto", "produtos", "fazer um pedido", "pedido"].includes(lower)
  const isDtf         = ["2", "dtf", "impressão dtf", "impressao dtf", "impressao", "impressão"].includes(lower)
  const isAtendimento = ["3", "atendimento", "atendente", "humano", "pessoa"].includes(lower)

  if (isProduto) {
    if (!chatbotProdutoEnabled || !produtoStatus.available) {
      await setState(contactId, !produtoStatus.available && dtfStatus.available ? "cross_sell_dtf" : "idle")
      replyWA(jid, buildUnavailableMsg("produto", produtoStatus, dtfStatus, globalSettings))
      return
    }
    await setState(contactId, "coletando", { rawMessages: [] })
    await sendCatalog(jid, contactId)

  } else if (isDtf) {
    if (!chatbotDtfEnabled || !dtfStatus.available) {
      await setState(contactId, !dtfStatus.available && produtoStatus.available ? "cross_sell_produto" : "idle")
      replyWA(jid, buildUnavailableMsg("dtf", dtfStatus, produtoStatus, globalSettings))
      return
    }
    await tagContact(contactId, "interessado_dtf")
    await setState(contactId, "dtf_verificando")
    replyWA(jid, "Você já tem o arquivo pronto pra impressão?")

  } else if (isAtendimento) {
    await pool.query(`
      UPDATE wa_contacts
      SET state = 'atendimento', needs_attention = true, state_data = '{}', updated_at = NOW()
      WHERE id = $1
    `, [contactId])
    replyWA(jid, "Certo! Nossa equipe entra em contato em breve durante o horário comercial. ⏰")

  } else {
    const firstName = pushName.split(" ")[0]
    replyWA(jid, `${firstName}, responde com:\n1️⃣ Fazer um pedido\n2️⃣ Impressão DTF\n3️⃣ Falar com atendimento`)
  }
}

async function handleDtfVerificando(
  jid: string,
  contactId: number,
  text: string,
  chatbotDtfEnabled = true
) {
  void chatbotDtfEnabled
  const lower = text.toLowerCase().trim()

  // Cliente quer que criemos a arte ou pergunta se temos estampa pronta
  const wantsCreation = ["cria", "criação", "criacao", "criar", "faz a arte", "fazer arte",
    "fazer arquivo", "montar arte", "montar arquivo", "estampa pronta", "estampas prontas",
    "tem estampa", "tem design", "design pronto", "vocês fazem", "voces fazem",
    "vocês criam", "voces criam", "pode fazer", "pode criar"].some(k => lower.includes(k))

  if (wantsCreation) {
    await setState(contactId, "dtf_sem_arquivo")
    replyWA(jid, "Trabalho só com impressão — recebo o arquivo pronto e rodo direto na máquina.\n\nNão fazemos criação de arte nem temos estampas prontas, mas posso te passar dicas rápidas de como preparar seu arquivo. Quer? 📋")
    return
  }

  const hasSim = ["sim", "s", "yes", "tenho", "ja tenho", "já tenho"].some(w => lower.includes(w))
  const hasNao = ["não", "nao", "n", "no", "não tenho", "nao tenho", "ainda não", "ainda nao"].some(w => lower.includes(w))

  if (hasSim) {
    await setState(contactId, "dtf_coletando", { larguraCm: null })
    replyWA(jid, "Pode mandar o arquivo aqui! 🖨️ Aceito imagem com largura de até 57cm.")
  } else if (hasNao) {
    await setState(contactId, "dtf_sem_arquivo")
    replyWA(jid, "A gente trabalha só com impressão — precisa do arquivo pronto pra rodar na máquina.\n\nPosso te passar dicas rápidas de como preparar. Quer? 📋")
  } else {
    replyWA(jid, "Você já tem o arquivo pronto pra impressão? Me fala *SIM* ou *NÃO*.")
  }
}

async function handleDtfSemArquivo(jid: string, contactId: number, text: string) {
  const lower = text.toLowerCase().trim()
  const wantsTip = ["sim", "s", "quero", "pode", "manda", "claro", "vai", "ok", "dica", "quer"].some(w => lower.includes(w))
  const noThanks = lower === "não" || lower === "nao" || lower === "n" || lower === "no"

  if (wantsTip) {
    await setState(contactId, "idle")
    replyWA(jid, DTF_TIPS)
  } else if (noThanks) {
    await setState(contactId, "idle")
    replyWA(jid, "Ok! Quando tiver o arquivo pronto é só chamar. 🖨️")
  } else {
    replyWA(jid, "Quer que eu te passe as dicas de como preparar o arquivo? Responde *SIM* ou *NÃO*.")
  }
}

async function handleCrossSellDtf(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string,
  chatbotDtfEnabled = false,
  dtfStatus: ServiceStatus = { available: true, reason: null }
) {
  const lower = text.toLowerCase().trim()
  const hasSim = ["sim", "s", "yes"].includes(lower)
  const hasNao = ["não", "nao", "n", "no"].includes(lower)

  if (hasSim) {
    if (!chatbotDtfEnabled || !dtfStatus.available) {
      await setState(contactId, "idle")
      replyWA(jid, "Para impressão DTF fala diretamente com a gente.")
      return
    }
    await setState(contactId, "dtf_verificando")
    replyWA(jid, "Você já tem o arquivo pronto pra rodar?")
  } else if (hasNao) {
    const orderId     = stateData.orderId     as number | undefined
    const orderNumber = stateData.orderNumber as string | undefined
    if (orderId && orderNumber) {
      await setState(contactId, "triagem", { orderId, orderNumber })
      replyWA(jid, `Ok! Pode me mandar mais itens do pedido *${orderNumber}* se precisar. Nossa equipe confirma e avisa quando estiver pronto.`)
    } else {
      await setState(contactId, "idle")
      replyWA(jid, "Ok! Qualquer coisa é só chamar.")
    }
  } else {
    replyWA(jid, "Você precisa de impressão DTF também? Responde *SIM* ou *NÃO*.")
  }
}

async function handleCrossSellProduto(
  jid: string,
  contactId: number,
  text: string,
  chatbotProdutoEnabled = true,
  produtoStatus: ServiceStatus = { available: true, reason: null }
) {
  const lower = text.toLowerCase().trim()
  const hasSim = ["sim", "s", "yes"].includes(lower)
  const hasNao = ["não", "nao", "n", "no"].includes(lower)

  if (hasSim) {
    if (!chatbotProdutoEnabled || !produtoStatus.available) {
      await setState(contactId, "idle")
      replyWA(jid, "Para pedidos de produto fala diretamente com a gente.")
      return
    }
    await setState(contactId, "coletando", { rawMessages: [] })
    await sendCatalog(jid, contactId)
  } else if (hasNao) {
    await setState(contactId, "idle")
    replyWA(jid, "Ok! Qualquer coisa é só chamar.")
  } else {
    replyWA(jid, "Você precisa de algum produto também? Responde *SIM* ou *NÃO*.")
  }
}

async function handleColetando(
  jid: string,
  contactId: number,
  stateData: Record<string, unknown>,
  text: string,
  chatbotDtfEnabled = false
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

  // DTF intent dentro de coletando → muda de fluxo
  const dtfTriggers = ["dtf", "impressão", "impressao", "imprimir", "metro de dtf", "arte dtf", "arquivo dtf", "arquivo pronto"]
  if (chatbotDtfEnabled && dtfTriggers.some(k => lower.includes(k))) {
    await setState(contactId, "dtf_verificando")
    replyWA(jid, "Você já tem o arquivo pronto pra impressão? (PNG, JPG ou PDF — largura máx. 57cm)")
    return
  }

  await setState(contactId, "coletando", { rawMessages, chatbotObs })
  await createOrderDirect(jid, contactId, rawMessages, chatbotObs, undefined, chatbotDtfEnabled)
}

async function createOrderDirect(
  jid: string,
  contactId: number,
  rawMessages: string[],
  chatbotObs: string | null = null,
  preParsed?: import("@/lib/ai/parseOrder").ParsedItem[],
  chatbotDtfEnabled = false
) {
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
        INSERT INTO orders (number, contact_id, status, total_value, source)
        VALUES ($1, $2, 'triagem', $3, 'whatsapp')
        RETURNING id, number
      `, [number, contactId, totalValue > 0 ? totalValue : null])
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

  const offeredDtf = await wasOfferedRecently(contactId, "cross_sell_dtf", 7)
  if (chatbotDtfEnabled && !offeredDtf) {
    await setState(contactId, "cross_sell_dtf", { orderId, orderNumber })
    reply += `\n\nVocê também precisa de impressão DTF?`
    await recordOffer(contactId, "cross_sell_dtf")
  } else {
    await setState(contactId, "triagem", { orderId, orderNumber })
    reply += `\n\nPode me mandar mais itens se precisar. Nossa equipe confirma e avisa quando estiver pronto!`
  }

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
  chatbotDtfEnabled = false
) {
  const lower = text.toLowerCase().trim()

  // Estado confirmando: espera SIM/NÃO do cliente antes de qualquer outra lógica
  if (state === "confirmando") {
    const orderId     = stateData?.orderId     as number | undefined
    const orderNumber = stateData?.orderNumber as string | undefined
    const isSim = ["sim", "s", "yes", "confirmo"].includes(lower)
    const isNao = ["não", "nao", "n", "no"].includes(lower)

    if (isSim && orderId) {
      await pool.query(`UPDATE orders SET status = 'em_separacao' WHERE id = $1`, [orderId])
      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'em_separacao', 'chatbot', 'Confirmado pelo cliente via WhatsApp')
      `, [orderId])
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
        `UPDATE wa_contacts SET needs_attention = true, updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      replyWA(jid, "Vou acionar a equipe agora!")
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
    // Sem pedido aberto em triagem, ou estado é em_separacao/pronto — cria novo
    const _raceOk = await setStateIf(contactId, "coletando", { rawMessages: [text] }, ["triagem", "em_separacao", "pronto"])
    if (!_raceOk) return
    await createOrderDirect(jid, contactId, [text], null, undefined, chatbotDtfEnabled)
    return
  }

  if (intent === "dtf") {
    await setState(contactId, "dtf_verificando")
    replyWA(jid, "Você já tem o arquivo pronto pra rodar?")
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
  try {
    const today = todayBR()
    const numRes = await pool.query(
      `SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`
    )
    const number = numRes.rows[0].num

    await pool.query(`
      INSERT INTO dtf_pedidos (number, data, contact_id, status, source, largura_cm)
      VALUES ($1, $2, $3, 'triagem', 'whatsapp', $4)
    `, [number, today, contactId, stateData.larguraCm ?? null])

    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, updated_at = NOW() WHERE id = $1`,
      [contactId]
    )

    await setState(contactId, "idle")
    replyWA(jid, `✅ Recebi! Protocolo *${number}* registrado.\nNossa equipe analisa e entra em contato em breve. 🖨️`)
  } catch (e) { console.error("[handleDtfMedia] falhou — migration dtf_pedidos/dtf_order_number_seq não rodou?", e) }
}
