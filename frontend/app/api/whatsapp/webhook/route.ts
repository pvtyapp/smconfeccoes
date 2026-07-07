import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { pool } from "@/lib/db"
import { parseOrder } from "@/lib/ai/parseOrder"
import { classifyIntent } from "@/lib/ai/classifyIntent"
import { classifyAndParse } from "@/lib/ai/classifyAndParse"
import { downloadEvolutionMedia, classifyMediaCategory, type MediaCategory } from "@/lib/whatsapp/media"
import { matchVariants, type MatchedItem } from "@/lib/whatsapp/matchVariant"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { todayBR } from "@/lib/tz"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

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

    const r = await fetch(`${EVO_URL}/chat/findChats/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ skip: 0, limit: 500 }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return
    const d = await r.json()
    const chats: Record<string, unknown>[] = Array.isArray(d) ? d
      : Array.isArray(d?.chats)   ? d.chats
      : Array.isArray(d?.records) ? d.records
      : []

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

// Envia E salva direto no banco (não depende do fromMe callback)
async function replyAndSave(contactId: number, jid: string, text: string): Promise<void> {
  waitUntil(
    sendWhatsApp(jid, text)
      .then(async (result) => {
        const msgId = (result as { key?: { id?: string } })?.key?.id ?? null
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
           VALUES ($1, $2, 'out', $3, NOW())
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [contactId, msgId, text]
        ).catch(() => {})
      })
      .catch(e => {
        console.error("[WA-webhook] replyAndSave failed:", jid, e instanceof Error ? e.message : e)
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

// Backwards compat — returns first message only (used for state machine)
function parseEvolutionMsg(data: unknown): Record<string, unknown> | undefined {
  return parseEvolutionMsgs(data)[0]
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

    const allMsgs = parseEvolutionMsgs(body?.data)
    if (allMsgs.length === 0) return NextResponse.json({ ok: true })

    // When Evolution batches multiple messages in one call (e.g. 2 files sent simultaneously),
    // persist ALL of them to wa_messages first so none are silently dropped.
    // The state machine below only runs for the first message.
    if (allMsgs.length > 1) {
      for (const extraMsg of allMsgs.slice(1)) {
        try {
          const eKey  = extraMsg.key as Record<string, unknown> | undefined
          const eJid  = (eKey?.remoteJid as string) || ""
          if (!eJid || eJid.endsWith("@g.us") || eKey?.fromMe) continue
          const eAlt  = (eKey?.remoteJidAlt as string) || ""
          const ePJid: string | null = eJid.endsWith("@lid") && eAlt.endsWith("@s.whatsapp.net") ? eAlt : null
          const ePhone = ePJid
            ? ePJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
            : eJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
          const eBody = extraMsg.message as Record<string, unknown> | undefined
          const eText: string =
            (eBody?.conversation as string) ||
            ((eBody?.extendedTextMessage as Record<string, unknown>)?.text as string) || ""
          const eHasMedia = !!(eBody?.imageMessage || eBody?.documentMessage || eBody?.videoMessage || eBody?.audioMessage)
          if (!eText.trim() && !eHasMedia) continue
          const eMeta = (() => {
            if (!eBody) return { mediaType: null as string | null, fileName: null as string | null, caption: null as string | null, thumbnail: null as string | null }
            if (eBody.imageMessage)    return { mediaType: "image",    fileName: null as string | null, caption: (eBody.imageMessage as Record<string,unknown>).caption as string ?? null, thumbnail: bufferToBase64((eBody.imageMessage as Record<string,unknown>).jpegThumbnail) }
            if (eBody.documentMessage) return { mediaType: "document", fileName: ((eBody.documentMessage as Record<string,unknown>).fileName as string) ?? null, caption: null as string | null, thumbnail: null as string | null }
            if (eBody.videoMessage)    return { mediaType: "video",    fileName: null as string | null, caption: (eBody.videoMessage as Record<string,unknown>).caption as string ?? null, thumbnail: bufferToBase64((eBody.videoMessage as Record<string,unknown>).jpegThumbnail) }
            if (eBody.audioMessage)    return { mediaType: "audio",    fileName: null as string | null, caption: null as string | null, thumbnail: null as string | null }
            return { mediaType: null as string | null, fileName: null as string | null, caption: null as string | null, thumbnail: null as string | null }
          })()
          const eMsgId = (eKey?.id as string) ?? null
          const eTs    = (extraMsg.messageTimestamp as number | undefined)
          const eCreatedAt = eTs ? new Date(eTs * 1000).toISOString() : null
          const { rows: eCRows } = await pool.query(
            `INSERT INTO wa_contacts (jid, phone, phone_jid) VALUES ($1, $2, $3)
             ON CONFLICT (jid) DO UPDATE SET phone_jid = COALESCE(EXCLUDED.phone_jid, wa_contacts.phone_jid), updated_at = NOW()
             RETURNING id`,
            [eJid, ePhone, ePJid]
          ).catch(() => ({ rows: [] as { id: number }[] }))
          if (!eCRows[0]) continue
          const eContactId = eCRows[0].id
          await pool.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_thumb, file_name, caption, created_at)
             VALUES ($1, $2, 'in', $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [eContactId, eMsgId, eText || (eHasMedia ? "[mídia]" : ""), eMeta.mediaType,
             eMeta.thumbnail ? `data:image/jpeg;base64,${eMeta.thumbnail}` : null,
             eMeta.fileName, eMeta.caption, eCreatedAt]
          ).catch(() => {})
          if (eHasMedia && eMeta.mediaType && eMeta.mediaType !== "sticker" && eMsgId) {
            waitUntil(saveMediaBackground(extraMsg, eContactId, eMsgId, eMeta.mediaType, "idle"))
          }
        } catch { /* silent — never crash webhook */ }
      }
    }

    const msg = allMsgs[0]

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

          if (contactId0 !== null) {
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

    // For @s.whatsapp.net incoming: if a @lid twin exists, route to it — prevents ghost cycling
    // when cleanup deleted the @s contact but client still messages via @s JID
    let overrideContactId: number | null = null
    if (jid.endsWith("@s.whatsapp.net") && phone.length >= 8) {
      const { rows: lidRows } = await pool.query(
        `SELECT id FROM wa_contacts
         WHERE jid LIKE '%@lid' AND (phone = $1 OR phone_jid = $2)
         LIMIT 1`,
        [phone, jid]
      ).catch(() => ({ rows: [] as { id: number }[] }))
      if (lidRows[0]) {
        overrideContactId = lidRows[0].id as number
        pool.query(
          `UPDATE wa_contacts
           SET phone_jid = COALESCE(phone_jid, $1),
               phone     = CASE WHEN phone ~ '^[0-9]{8,15}$' THEN phone ELSE $2 END,
               updated_at = NOW()
           WHERE id = $3`,
          [jid, phone, overrideContactId]
        ).catch(() => {})
      }
    }

    const contactRes = overrideContactId
      ? await pool.query(
          `SELECT id, state, state_data AS "stateData", lifecycle_state AS "lifecycleState",
                  updated_at AS "updatedAt", last_order_at AS "lastOrderAt"
           FROM wa_contacts WHERE id = $1`,
          [overrideContactId]
        )
      : await pool.query(`
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

    // Essa mensagem não trouxe o número real — tenta resolver em background sem
    // esperar o cron diário (ver resolveLidPhoneInBackground no topo do arquivo)
    if (jid.endsWith("@lid") && !phoneJid) {
      waitUntil(resolveLidPhoneInBackground(jid, contact.id))
    }

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
    const globalSettings: Record<string, string> = {}
    try {
      const { rows: gs } = await pool.query(`SELECT key, value FROM app_settings`)
      for (const r of gs) {
        globalSettings[r.key] = r.value
        if (r.key === "chatbot_ativo") globalChatbotAtivo = r.value === "true"
      }
    } catch { /* use defaults */ }

    const produtoDispo   = await hasProdutoDisponivel()
    const produtoBase    = getServiceStatus("produto", globalSettings)
    const produtoStatus: ServiceStatus = produtoDispo
      ? produtoBase
      : { available: false, reason: "desativado" }
    const dtfStatus      = getServiceStatus("dtf", globalSettings)

    if (!globalChatbotAtivo) {
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
      await handleMedia(jid, contact.id, msg, state)
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

// Ordem padrão de vestuário para tamanhos
const SIZE_ORDER = ["pp", "p", "m", "g", "gg", "ggg", "gggg", "único", "unico", "u",
  "xs", "s", "l", "xl", "xxl", "xxxl", "2", "4", "6", "8", "10", "12", "14", "16"]
function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.toLowerCase().trim())
    const bi = SIZE_ORDER.indexOf(b.toLowerCase().trim())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
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

async function resolveProductKeyword(text: string, rootContext?: string): Promise<string> {
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

  // Pass 3: rootContext ativo — busca palavra do texto dentro dos produtos da mesma raiz
  if (rootContext) {
    const normRoot = norm(rootContext)
    const siblings = rows.filter(r => norm(r.root_category ?? "") === normRoot)
    for (const row of siblings) {
      const pWords = norm(row.name as string).split(/\s+/).filter(Boolean)
      if (pWords.some(w => w.length > 2 && lower.includes(w))) {
        return (row.name as string).toLowerCase()
      }
    }
  }

  // Pass 4: texto bate com nome de categoria raiz que tem múltiplos produtos → @CAT:
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
    return `${emoji} ${p.name}`
  })

  await replyAndSave(contactId, jid, `Quer ver as cores de qual produto? 👇\n\n${lines.join("\n")}\n\nMe fala o nome (ou *todos* pra ver tudo)`)
  // Reseta rawMessages + marca awaiting + atualiza timestamp
  pool.query(
    `UPDATE wa_contacts
     SET last_catalog_sent_at = NOW(),
         state_data = jsonb_build_object(
           'awaitingCatalogResponse', true,
           'chatbotObs', COALESCE(state_data->>'chatbotObs', null)
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [contactId]
  ).catch(() => {})
}

// ─── drill-down de categoria ─────────────────────────────────────────────────

async function sendCategoryDrill(jid: string, contactId: number, rootCategoryName: string) {
  const { rows } = await pool.query(`
    SELECT p.name, COALESCE(pv_min.min_price, p.sale_price, 0)::float AS sale_price
    FROM products p
    JOIN categories cat  ON cat.id  = p.category_id
    JOIN categories root ON root.id = cat.parent_id
    LEFT JOIN (
      SELECT product_id, MIN(sale_price) AS min_price
      FROM product_variants WHERE status = 'active' GROUP BY product_id
    ) pv_min ON pv_min.product_id = p.id
    WHERE root.name ILIKE $1
      AND p.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
    ORDER BY p.name
  `, [rootCategoryName])

  if (!rows.length) { await sendCatalog(jid, contactId, true); return }

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const emojiMap: Record<string, string> = {
    moletom: "🧥", camiseta: "👕", bermuda: "🩳", calca: "👖", calça: "👖",
    conjunto: "👗", blusa: "🧣", short: "🩳",
  }
  const rootWords = norm(rootCategoryName).split(/\s+/)

  const lines = rows.map(p => {
    const nl    = norm(p.name as string)
    const emoji = Object.entries(emojiMap).find(([k]) => nl.includes(k))?.[1] ?? "📦"
    // mostra só as palavras que diferenciam (remove palavras da raiz)
    const unique = nl.split(/\s+/).filter(w => !rootWords.includes(w))
    const label  = unique.length
      ? unique.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : (p.name as string)
    const price  = Number(p.sale_price) > 0
      ? ` · R$ ${Number(p.sale_price).toFixed(2).replace(".", ",")}`
      : ""
    return `${emoji} ${label}${price}`
  })

  // Grava contexto de raiz no state_data — próxima mensagem do cliente resolve dentro desta raiz
  pool.query(
    `UPDATE wa_contacts
     SET state_data = jsonb_build_object(
       'awaitingCatalogResponse', true,
       'rootCategoryContext', $2::text,
       'chatbotObs', COALESCE(state_data->>'chatbotObs', null)
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [contactId, rootCategoryName]
  ).catch(() => {})

  await replyAndSave(contactId, jid,
    `*${rootCategoryName}* — qual tipo?\n\n${lines.join("\n")}\n\nMe fala qual você quer.`)
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
  // Mantém awaitingCatalogResponse ativo — limpa só quando vier dígito (pedido real)
  // Reseta rawMessages para não acumular lixo de consulta
  pool.query(
    `UPDATE wa_contacts
     SET state_data = jsonb_build_object(
       'awaitingCatalogResponse', true,
       'chatbotObs', COALESCE(state_data->>'chatbotObs', null)
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [contactId]
  ).catch(() => {})

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
    await sendCategoryDrill(jid, contactId, keyword.slice(5))
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

async function handleMedia(
  jid: string,
  contactId: number,
  msg: unknown,
  state: string,
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

  // Arquivo solto, fora de qualquer fluxo — não tenta adivinhar o que é (comprovante, arte, etc).
  // Acha ou cria um pedido DTF virgem só pra aparecer no kanban; operador vincula o arquivo manualmente.
  const { rows: openPedido } = await pool.query(
    `SELECT id FROM dtf_pedidos
     WHERE contact_id = $1 AND status NOT IN ('em_producao', 'pronto', 'concluido', 'cancelado')
     ORDER BY created_at DESC LIMIT 1`,
    [contactId]
  )
  if (!openPedido[0]) {
    const numRes = await pool.query(`SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`)
    await pool.query(
      `INSERT INTO dtf_pedidos (number, data, contact_id, status, source) VALUES ($1, $2, $3, 'triagem', 'whatsapp')`,
      [numRes.rows[0].num, todayBR(), contactId]
    )
  }
  // O próprio pedido virgem no kanban já é o alerta — não marca needs_attention na conversa

  // Dedup: cliente pode mandar vários arquivos ao mesmo tempo — não repete a mensagem
  const { rows: recentAck } = await pool.query(
    `SELECT 1 FROM wa_messages WHERE contact_id = $1 AND direction = 'out'
     AND content = 'Recebi seu arquivo! Já vou te atender. 😊'
     AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
    [contactId]
  )
  if (!recentAck.length) {
    await replyAndSave(contactId, jid, "Recebi seu arquivo! Já vou te atender. 😊")
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
      await replyAndSave(contactId, jid, "Ok! Me chama quando precisar. 😊")
      return
    }

    const order = await getMostRecentOrder(contactId)

    if (order?.status === "pago") {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      await replyAndSave(contactId, jid, `Seu pedido *${order.number}* já está pago e pronto para retirada. Preciso acionar a equipe — eles entram em contato agora.`)
      return
    }

    if (order?.status === "em_separacao") {
      // Estorna estoque antes de cancelar
      const { rows: alreadyReverted } = await pool.query(
        `SELECT 1 FROM stock_movements WHERE notes = $1 AND type = 'in' LIMIT 1`,
        [`Estorno ${order.number}`]
      )
      if (!alreadyReverted.length) {
        const { rows: items } = await pool.query(
          `SELECT variant_id, qty::int AS qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`,
          [order.id]
        )
        for (const item of items) {
          await pool.query(
            `INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes) VALUES ($1, 'in', $2, 'estorno_cancelamento', 'chatbot', $3)`,
            [item.variant_id, item.qty, `Estorno ${order.number}`]
          )
        }
      }
      await pool.query(`UPDATE orders SET status = 'cancelado' WHERE id = $1`, [order.id])
      await pool.query(`
        INSERT INTO order_events (order_id, status, actor, note)
        VALUES ($1, 'cancelado', 'chatbot', 'Cliente solicitou cancelamento durante separação')
      `, [order.id])
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'cancelamento', state = 'idle', state_data = '{}', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      await replyAndSave(contactId, jid, `Ok! Avisamos a equipe para parar a separação do pedido *${order.number}*.`)
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
    await replyAndSave(contactId, jid, "Ok, cancelado. Quando precisar é só chamar.")
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
      WHERE contact_id = $1 AND status IN ('triagem', 'confirmando', 'em_separacao', 'pago')
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
  const lowerIdle = text.toLowerCase().trim()

  // Atendimento humano — detecta antes de qualquer outro processamento
  const atendimentoKwIdle = ["atendimento", "atendente", "falar com", "fala com", "humano", "responsável", "responsavel"]
  if (atendimentoKwIdle.some(k => lowerIdle.includes(k))) {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'solicitou_atendimento', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    await setState(contactId, "coletando", { rawMessages: [], chatbotObs })
    replyWA(jid, "Ok! Já aviso nossa equipe, em breve alguém te chama. 😊")
    return
  }

  // Returning client — direct flow
  if (lastOrderAt) {
    // Catálogo direto — não passa pelo classifyAndParse
    if (["catalogo", "catálogo", "produtos", "cardapio", "cardápio"].includes(lowerIdle)) {
      await sendCatalog(jid, contactId)
      return
    }

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

    if (intent === "dtf" || ["monta o arquivo", "monta arquivo", "vc monta", "voce monta", "você monta"].some(k => lowerIdle.includes(k))) {
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
      const res = await pool.query(`SELECT id FROM orders WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1`, [contactId])
      if (res.rows[0]) {
        await pool.query(
          `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'status', updated_at = NOW() WHERE id = $1`,
          [contactId]
        )
        return
      }
      // sem pedido nenhum ainda — cai no fluxo normal de começar um pedido
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

  if (newIntent === "dtf" || ["monta o arquivo", "monta arquivo", "vc monta", "voce monta", "você monta"].some(k => lowerIdle.includes(k))) {
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

  // Atendimento humano — marca atenção e responde
  const atendimentoKw = ["atendimento", "atendente", "falar com", "fala com", "humano", "responsável", "responsavel"]
  if (atendimentoKw.some(k => lower.includes(k))) {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'solicitou_atendimento', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    await replyAndSave(contactId, jid, "Ok! Já aviso nossa equipe, em breve alguém te chama. ��")
    return
  }

  // Cancelar / alterar pedido — marca atenção
  const cancelKw  = ["cancela", "cancelar", "quero cancelar", "cancelamento"]
  const alterKw   = ["quero alterar", "alterar pedido", "mudar pedido", "remover item", "trocar item"]
  if (cancelKw.some(k => lower.includes(k)) || alterKw.some(k => lower.includes(k))) {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'pediu_alteracao', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    await replyAndSave(contactId, jid, "Ok! Já aviso nossa equipe pra te ajudar com isso. 😊")
    return
  }

  // Se veio do smart greeting e é a primeira resposta do cliente, aceita negação graciosamente
  if (smartGreeted && (stateData.rawMessages as string[] ?? []).length === 0) {
    const isNegation = ["não", "nao", "n", "no", "não preciso", "nao preciso", "agora não", "agora nao", "hoje não", "hoje nao"]
      .some(w => lower === w || lower.startsWith(w + " "))
    if (isNegation) {
      await setState(contactId, "idle")
      await replyAndSave(contactId, jid, "Ok! Me chama quando precisar.")
      return
    }
  }

  // Catálogo direto
  if (lower === "catalogo" || lower === "catálogo" || lower === "produtos" || lower === "cardapio" || lower === "cardápio") {
    await sendCatalog(jid, contactId, true)
    return
  }

  // Pergunta de preço → mostra catálogo (keywords específicas pra evitar capturar "quanto vai dar de X moletom")
  const priceTerms = ["preço", "preco", "tabela", "quanto custa", "quanto vale",
    "quanto fica", "qual o valor", "qual valor", "me passa o preço", "me manda o preço", "custa?", "valores"]
  if (priceTerms.some(k => lower.includes(k))) {
    await sendCatalog(jid, contactId)
    return
  }

  // Aguardando seleção de produto do catálogo: interpreta a resposta como nome de produto
  const awaitingCatalog = Boolean(stateData.awaitingCatalogResponse)
  const rootContext      = stateData.rootCategoryContext as string | undefined
  if (awaitingCatalog) {
    if (/\d/.test(text)) {
      // Tem número = pedido real — limpa flag e contexto de categoria
      pool.query(
        `UPDATE wa_contacts SET state_data = state_data - 'awaitingCatalogResponse' - 'rootCategoryContext', updated_at = NOW() WHERE id = $1`,
        [contactId]
      ).catch(() => {})
      // não retorna — continua o processamento normal
    } else {
      const isTodos = ["todos", "tudo", "todos os produtos", "todos produtos", "ver tudo"].includes(lower.trim())
      if (isTodos) {
        await handleVariacao(jid, contactId, "todos")
        return
      }
      const kw = await resolveProductKeyword(text, rootContext)
      if (kw.startsWith("@CAT:")) {
        await sendCategoryDrill(jid, contactId, kw.slice(5))
        return
      }
      if (kw) {
        // Passa o keyword resolvido (não o texto) para não perder contexto de raiz
        await handleVariacao(jid, contactId, kw)
        return
      }
      // Não reconheceu o produto → reapresenta a lista
      await sendCatalog(jid, contactId, true)
      return
    }
  }

  // Ruído: saudações e mensagens sem conteúdo de pedido → não acumula em rawMessages
  const isNoise = /^(oi|olá|ola|ok|okay|blz|beleza|tá|ta|sim|s|👍|✅|😊|🙏|valeu|obg|obrigad|pi|pe|po|pu|né|ne|aí|ai|hm|hmm|ah|eh|é|e|opa|eae|eaí|eai)$/.test(lower)
    || (lower.length <= 3 && !/^\d/.test(lower) && !["não","nao"].includes(lower))
  if (isNoise && (stateData.rawMessages as string[] ?? []).length === 0) {
    replyWA(jid, "Me manda o pedido: produto, cor e tamanho. Ex: _20 moletom preto G_")
    return
  }

  // Saudação comprida ("boa noite", "bom dia" etc.) → não vai para createOrderDirect
  const isGreeting = /^(boa (noite|tarde|dia)|bom dia|ol[aá]|tudo (bem|bom)|como vai|oi boa|hey|hello)/.test(lower)
  if (isGreeting && (stateData.rawMessages as string[] ?? []).length === 0) {
    replyWA(jid, "Me manda o pedido: produto, cor e tamanho. Ex: _20 moletom preto G_")
    return
  }

  // Pergunta de cor/tamanho → mostra variações sem sair do fluxo
  if (/\bcor\b/.test(lower) || /\bcores\b/.test(lower) || /\btamanho\b/.test(lower) || /\btamanhos\b/.test(lower) || lower.includes("disponivel") || lower.includes("disponível")) {
    await handleVariacao(jid, contactId, text)
    return
  }

  // Sem dígito + produto identificado → consulta, não pedido
  // Captura: "tem camiseta preta?", "e moletom?", "moletom adulto", "camisetas" etc.
  const hasDigit = /\d/.test(text)
  if (!hasDigit) {
    const kw = await resolveProductKeyword(text)
    if (kw.startsWith("@CAT:")) {
      await sendCategoryDrill(jid, contactId, kw.slice(5))
      return
    }
    if (kw) {
      await handleVariacao(jid, contactId, text)
      return
    }
  }

  // DTF intent dentro de coletando → resposta direta (não fazemos criação de arte)
  const dtfTriggers = ["dtf", "impressão", "impressao", "imprimir", "metro de dtf", "arte dtf", "arquivo dtf", "arquivo pronto", "monta o arquivo", "monta arquivo", "montar arquivo", "vc monta", "voce monta", "você monta", "faz o arquivo", "faz arquivo"]
  if (dtfTriggers.some(k => lower.includes(k))) {
    await replyAndSave(contactId, jid, "Pode mandar o arquivo de DTF direto aqui! 🖨️")
    return
  }

  // Tem dígito → é pedido real: limpa awaiting e segue pro createOrderDirect
  pool.query(
    `UPDATE wa_contacts SET state_data = state_data - 'awaitingCatalogResponse', updated_at = NOW() WHERE id = $1`,
    [contactId]
  ).catch(() => {})

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

  await setState(contactId, "triagem", { orderId, orderNumber })
  await replyAndSave(contactId, jid, `✅ Pedido *${orderNumber}* anotado!\n\nVamos organizar! Se precisar ajustar algo é só falar.`)

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

  await replyAndSave(contactId, jid, `✅ Pedido *${orderNumber}* anotado!\n\nVamos organizar! Se precisar ajustar algo é só falar.`)

  pool.query(`SELECT value FROM app_settings WHERE key = 'operador_jid'`).then(({ rows }) => {
    const opJid = rows[0]?.value
    if (opJid && opJid !== jid) {
      replyWA(opJid, `🛍️ *Novo pedido ${orderNumber}* — sem produto identificado, revisar mensagem do cliente.`)
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

async function buildOrderList(orderId: number, orderNumber: string): Promise<string> {
  const { rows: items } = await pool.query(
    `SELECT product_name, color, size, qty::int AS qty, unit_price::float AS unit_price
     FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId]
  )
  if (!items.length) return `Pedido *${orderNumber}* — sem itens.`
  const lines = items.map((it, i) => {
    const desc  = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
    const price = it.unit_price ? ` · R$ ${(it.unit_price * it.qty).toFixed(2).replace(".", ",")}` : ""
    return `${i + 1}. ${desc} · *${it.qty} un*${price}`
  })
  const total    = items.reduce((s, it) => s + (it.unit_price ?? 0) * it.qty, 0)
  const totalStr = total > 0 ? `\n\n💰 *Total: R$ ${total.toFixed(2).replace(".", ",")}*` : ""
  return `📋 Pedido *${orderNumber}*:\n\n${lines.join("\n")}${totalStr}`
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

  const reminderSent  = Boolean(stateData.contextReminderSent)
  const orderNumber   = (stateData.orderNumber as string) ?? ""

  async function sendReminder(msg: string) {
    await replyAndSave(contactId, jid, msg)
    await pool.query(
      `UPDATE wa_contacts SET state_data = state_data || '{"contextReminderSent":true}'::jsonb, updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
  }

  // ── confirmando — informa uma vez, depois silêncio ─────────────────────────
  if (state === "confirmando") {
    if (!reminderSent && orderNumber) {
      await sendReminder(`Seu pedido *${orderNumber}* está sendo verificado pela equipe! Se precisar de alguma alteração, é só responder aqui. 😊`)
    }
    return
  }

  // ── pergunta de prazo → só marca atenção, sem resposta ────────────────────
  const prazoKw = ["quando", "quanto tempo", "cadê", "cade", "terminou",
    "entrega", "retirada", "posso buscar", "posso retirar",
    "ta pronto", "tá pronto", "ficou pronto", "status", "meu pedido"]

  if (state === "em_separacao" || state === "pronto" || state === "pago") {
    if (prazoKw.some(k => lower.includes(k))) {
      await pool.query(
        `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'prazo', updated_at = NOW() WHERE id = $1`,
        [contactId]
      )
      return
    }
  }

  // ── em_separacao — informa uma vez, depois silêncio ────────────────────────
  if (state === "em_separacao") {
    if (!reminderSent && orderNumber) {
      await sendReminder(`Seu pedido *${orderNumber}* já está em separação! ✂️ Avisamos quando estiver pronto.`)
    }
    return
  }

  // ── pronto — informa uma vez, depois silêncio ───────────────────────────────
  if (state === "pronto") {
    if (!reminderSent && orderNumber) {
      await sendReminder(`Seu pedido *${orderNumber}* está pronto para retirada! Pode vir buscar quando quiser. 😊`)
    }
    return
  }

  // ── pago — silêncio (ação interna do operador) ──────────────────────────────
  if (state === "pago") {
    return
  }

  // ── triagem — informa uma vez, mas CONTINUA processando a mensagem ──────────
  if (state === "triagem" && !reminderSent && orderNumber) {
    await sendReminder(`Seu pedido *${orderNumber}* está na lista! Nossa equipe já está conferindo. 😊`)
    // não retorna — a mensagem que disparou o reminder também é processada abaixo
  }

  const intent = await classifyIntent(text)

  // ── remover / alterar pedido em triagem — edição não é mais por texto ───────
  // Operador resolve no Gerenciador de Pedidos, vendo a conversa aberta.
  if ((intent === "remover" || intent === "alterar") && state === "triagem") {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = $1, updated_at = NOW() WHERE id = $2`,
      [intent === "remover" ? "remover" : "pediu_alteracao", contactId]
    )
    await replyAndSave(contactId, jid, "Ok! Já aviso nossa equipe pra ajustar isso pra você. 😊")
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
            await replyAndSave(contactId, jid, "Não entendi. Me passa: _10 moletom preto P_")
            return
          }
          if (!parsed.length) {
            await replyAndSave(contactId, jid, "Não consegui identificar os itens. Me manda: _10 moletom preto P_")
            return
          }
          const matched = await matchVariants(parsed)
          for (const item of matched) {
            await pool.query(`
              INSERT INTO order_items (order_id, product_name, color, size, qty, variant_id, unit_price)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [openOrders[0].id, item.productName, item.color || "", item.size || "", item.qty, item.variantId, item.unitPrice])
          }
          const newLines  = matched.map(m => `• ${[m.productName, m.color, m.size].filter(Boolean).join(" ")} · *${m.qty} un*`)
          const fullList  = await buildOrderList(openOrders[0].id as number, openOrders[0].number as string)
          await replyAndSave(contactId, jid,
            `✅ Adicionei ao *${openOrders[0].number}*:\n${newLines.join("\n")}\n\n${fullList}\n\nPode continuar adicionando!`)
          return
        }
      }
    }
    // em_separacao ou pronto → novo pedido vinculado ao anterior
    const parentOrderId = stateData?.orderId as number | undefined
    const _raceOk = await setStateIf(contactId, "coletando", { rawMessages: [text] }, ["triagem", "em_separacao", "pago"])
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
    await replyAndSave(contactId, jid, "Pode mandar o arquivo de DTF direto aqui! 🖨️")
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

  if (intent === "ver_pedido" || intent === "status") {
    await pool.query(
      `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'status', updated_at = NOW() WHERE id = $1`,
      [contactId]
    )
    return
  }

  const firstName = pushName.split(" ")[0]
  await pool.query(
    `UPDATE wa_contacts SET needs_attention = true, attention_reason = 'mensagem_livre', updated_at = NOW() WHERE id = $1`,
    [contactId]
  )
  await replyAndSave(contactId, jid, `Oi ${firstName}! Seu pedido está em andamento. Qualquer dúvida nossa equipe já vai ver. 😊`)
}

// ─── Reserva: resposta do cliente (legado — estado nunca mais setado pelo chatbot) ──


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

