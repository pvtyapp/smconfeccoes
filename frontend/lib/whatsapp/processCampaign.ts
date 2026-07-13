import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"

type Recipient = { jid: string; id?: number; name: string; isGroup?: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelay = () => sleep(3000 + Math.random() * 5000) // 3–8s, evita padrão previsível

// Processa até maxMessages destinatários de uma campanha "sending", um de cada vez, com
// trava atômica (só avança se sent_count bater exato) — chamada por /api/marketing/tick
// (maxMessages=1, escopada num campaignId específico — poll da tela por campanha aberta)
// e /api/whatsapp/cron (maxMessages=8, sem campaignId — pega a mais antiga em fila).
// Antes existiam 2 cópias divergentes dessa lógica sem essa trava, que podiam mandar a
// mesma mensagem duas vezes se rodassem ao mesmo tempo.
export async function processCampaignBatch(
  maxMessages: number,
  campaignId?: number
): Promise<{ processed: number; errors: number }> {
  let processed = 0
  let errors = 0

  for (let i = 0; i < maxMessages; i++) {
    const { rows } = campaignId
      ? await pool.query(`
          SELECT id, content, media_url, recipients_json, sent_count, total_count
          FROM marketing_campaigns WHERE id = $1 AND status = 'sending'
        `, [campaignId])
      : await pool.query(`
          SELECT id, content, media_url, recipients_json, sent_count, total_count
          FROM marketing_campaigns
          WHERE status = 'sending'
          ORDER BY created_at ASC
          LIMIT 1
        `)
    const camp = rows[0]
    if (!camp) break

    if (!camp.recipients_json) {
      await pool.query(`UPDATE marketing_campaigns SET status = 'sent', executed_at = NOW() WHERE id = $1`, [camp.id])
      break
    }

    const recipients = camp.recipients_json as Recipient[]
    const idx = camp.sent_count as number

    if (idx >= recipients.length) {
      await pool.query(`UPDATE marketing_campaigns SET status = 'sent', executed_at = NOW() WHERE id = $1`, [camp.id])
      break
    }

    // Trava atômica — se duas chamadas pegarem o mesmo sent_count ao mesmo tempo, só uma consegue
    const { rowCount } = await pool.query(
      `UPDATE marketing_campaigns SET sent_count = sent_count + 1
       WHERE id = $1 AND sent_count = $2 AND status = 'sending'`,
      [camp.id, idx]
    )
    if ((rowCount ?? 0) === 0) continue

    const recipient = recipients[idx]
    const mediaUrl = camp.media_url as string | null
    let hasError = false
    let skipped = false

    let sendJid = recipient.jid as string
    if (recipient.id && !recipient.isGroup) {
      const { rows: jr } = await pool.query(
        `SELECT COALESCE(phone_jid,
           CASE WHEN jid NOT LIKE '%@lid' THEN jid ELSE NULL END
         ) AS send_jid,
         COALESCE(marketing_optout, false) AS optout,
         last_marketing_sent_at
         FROM wa_contacts WHERE id = $1`,
        [recipient.id]
      ).catch(() => ({ rows: [] as { send_jid: string | null; optout: boolean; last_marketing_sent_at: Date | null }[] }))

      const g = jr[0]
      if (g?.optout) skipped = true
      else if (g?.last_marketing_sent_at && (Date.now() - new Date(g.last_marketing_sent_at).getTime()) < 20 * 60 * 60 * 1000) skipped = true
      else if (g?.send_jid) sendJid = g.send_jid
    }
    if (!skipped && sendJid.endsWith("@lid")) skipped = true

    if (!skipped) {
      try {
        const firstName = ((recipient.name as string | null) ?? "").split(" ")[0]
        const msg = recipient.isGroup
          ? (camp.content as string)
          : (camp.content as string).replace(/\{nome\}/g, firstName)

        let msgId: string | null = null
        try {
          msgId = await campaignSend(sendJid, msg, mediaUrl)
        } catch (mediaErr) {
          console.error("[processCampaignBatch] sendMedia falhou para", sendJid, "—", mediaErr instanceof Error ? mediaErr.message : mediaErr)
          if (mediaUrl) msgId = await campaignSend(recipient.jid, msg, null)
          else throw mediaErr
        }

        if (recipient.id) {
          await pool.query(`UPDATE wa_contacts SET last_marketing_sent_at = NOW() WHERE id = $1`, [recipient.id]).catch(() => {})
          await pool.query(
            `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_url, media_type)
             VALUES ($1,$2,'out',$3,$4,$5)
             ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
            [recipient.id, msgId, msg, mediaUrl ?? null, mediaUrl ? "image" : null]
          ).catch(() => {})
        }
        processed++
      } catch (e) {
        console.error("[processCampaignBatch] erro final no recipient", recipient.jid, "—", e instanceof Error ? e.message : e)
        hasError = true
        errors++
      }
    }

    const newCount = idx + 1
    const isDone = newCount >= (camp.total_count as number)
    await pool.query(
      `UPDATE marketing_campaigns
       SET error_count = error_count + $1,
           status = CASE WHEN $2 THEN 'sent' ELSE status END,
           executed_at = CASE WHEN $2 THEN NOW() ELSE executed_at END
       WHERE id = $3`,
      [hasError ? 1 : 0, isDone, camp.id]
    )

    if (isDone) break
    if (maxMessages > 1 && i < maxMessages - 1) await randDelay()
  }

  return { processed, errors }
}
