import { pool } from "@/lib/db"
import { campaignSend, EvolutionDisconnectedError } from "@/lib/whatsapp/campaignSend"

type Recipient = { jid: string; id?: number; name: string; isGroup?: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const randDelayGroup  = () => sleep(3000 + Math.random() * 5000)   // 3-8s, grupo — risco baixo, ritmo de sempre
const randDelayClient = () => sleep(40000 + Math.random() * 20000) // 40-60s, cliente individual — mais devagar ainda (era 8-20s até 2026-08-10)

const BATCH_SIZE     = 30
const BATCH_COOLDOWN_MS = 5 * 60 * 1000

// Processa até maxMessages destinatários de uma campanha "sending", um de cada vez, com
// trava atômica (só avança se sent_count bater exato) — chamada por /api/marketing/tick
// (maxMessages=1, escopada num campaignId específico — poll da tela por campanha aberta)
// e /api/whatsapp/cron (maxMessages=8, sem campaignId — pega a mais antiga em fila).
// Antes existiam 2 cópias divergentes dessa lógica sem essa trava, que podiam mandar a
// mesma mensagem duas vezes se rodassem ao mesmo tempo.
//
// Destinatário individual (cliente) manda pela instância isolada de marketing; grupo
// continua na instância principal, como sempre. Se content_variants existir (texto
// reescrito por IA), cada destinatário pega uma variação em rodízio em vez do texto
// único. A cada 30 clientes processados entra uma pausa de 5min (pause_reason=
// 'batch_cooldown'); se a Evolution reportar desconectada, pausa também
// (pause_reason='disconnected') e só volta com ação manual do operador.
export async function processCampaignBatch(
  maxMessages: number,
  campaignId?: number
): Promise<{ processed: number; errors: number }> {
  let processed = 0
  let errors = 0

  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS content_variants JSONB`).catch(() => {})
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS pause_reason TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS instance_name TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS last_ticked_at TIMESTAMPTZ`).catch(() => {})

  for (let i = 0; i < maxMessages; i++) {
    // Chamada com campaignId (tela aberta, poll de 30s) sempre pode pegar a
    // própria campanha. Chamada sem campaignId (cron da Vercel, a cada 5min)
    // pula qualquer campanha "tickada" pela tela nos últimos 90s — evita os
    // dois motores mandarem pra mesma campanha ao mesmo tempo e furarem o
    // intervalo anti-ban (cron só assume quando a tela para de cutucar).
    const { rows } = campaignId
      ? await pool.query(`
          SELECT id, content, media_url, recipients_json, sent_count, total_count,
                 content_variants, paused_until, pause_reason, instance_name
          FROM marketing_campaigns WHERE id = $1 AND status = 'sending'
        `, [campaignId])
      : await pool.query(`
          SELECT id, content, media_url, recipients_json, sent_count, total_count,
                 content_variants, paused_until, pause_reason, instance_name
          FROM marketing_campaigns
          WHERE status = 'sending'
            AND (last_ticked_at IS NULL OR last_ticked_at < NOW() - INTERVAL '90 seconds')
          ORDER BY created_at ASC
          LIMIT 1
        `)
    const camp = rows[0]
    if (!camp) break

    if (camp.pause_reason === "disconnected") break

    if (camp.pause_reason === "batch_cooldown") {
      if (camp.paused_until && new Date(camp.paused_until as string) > new Date()) break
      await pool.query(
        `UPDATE marketing_campaigns SET pause_reason = NULL, paused_until = NULL WHERE id = $1`,
        [camp.id]
      )
    }

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

    // Trava atômica — se duas chamadas pegarem o mesmo sent_count ao mesmo tempo, só uma consegue.
    // Só marca last_ticked_at quando vem da tela (campaignId presente) — é esse carimbo que faz
    // o cron da Vercel dar um passo pra trás enquanto a tela tá ativa.
    const { rowCount } = campaignId
      ? await pool.query(
          `UPDATE marketing_campaigns SET sent_count = sent_count + 1, last_ticked_at = NOW()
           WHERE id = $1 AND sent_count = $2 AND status = 'sending'`,
          [camp.id, idx]
        )
      : await pool.query(
          `UPDATE marketing_campaigns SET sent_count = sent_count + 1
           WHERE id = $1 AND sent_count = $2 AND status = 'sending'`,
          [camp.id, idx]
        )
    if ((rowCount ?? 0) === 0) continue

    const recipient = recipients[idx]
    const mediaUrl = camp.media_url as string | null
    const variants = camp.content_variants as string[] | null
    // Grupo sempre pelo número principal (baixo risco, sempre foi assim).
    // Cliente usa o número de marketing que essa campanha já recebeu fixo na
    // criação (pode ser 1 de N números cadastrados) — null cai pro principal
    // se nenhum número de marketing estava conectado na hora de criar.
    const instanceName: string | null = recipient.isGroup ? null : (camp.instance_name as string | null)
    let hasError = false
    let disconnected = false
    let skipped = false

    let sendJid = recipient.jid as string
    if (recipient.id && !recipient.isGroup) {
      const { rows: jr } = await pool.query(
        `SELECT jid AS send_jid,
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

    if (!skipped) {
      try {
        const firstName = ((recipient.name as string | null) ?? "").split(" ")[0]
        const baseContent = (!recipient.isGroup && variants && variants.length > 0)
          ? variants[idx % variants.length]
          : (camp.content as string)
        const msg = recipient.isGroup
          ? baseContent
          : baseContent.replace(/\{nome\}/gi, firstName)

        let msgId: string | null = null
        try {
          msgId = await campaignSend(sendJid, msg, mediaUrl, instanceName)
        } catch (mediaErr) {
          if (mediaErr instanceof EvolutionDisconnectedError) throw mediaErr
          console.error("[processCampaignBatch] sendMedia falhou para", sendJid, "—", mediaErr instanceof Error ? mediaErr.message : mediaErr)
          if (mediaUrl) msgId = await campaignSend(recipient.jid, msg, null, instanceName)
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
        if (e instanceof EvolutionDisconnectedError) disconnected = true
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

    if (disconnected) {
      await pool.query(
        `UPDATE marketing_campaigns SET pause_reason = 'disconnected' WHERE id = $1`,
        [camp.id]
      )
      break
    }

    if (isDone) break

    if (!recipient.isGroup && newCount % BATCH_SIZE === 0) {
      const pausedUntil = new Date(Date.now() + BATCH_COOLDOWN_MS)
      await pool.query(
        `UPDATE marketing_campaigns SET pause_reason = 'batch_cooldown', paused_until = $1 WHERE id = $2`,
        [pausedUntil, camp.id]
      )
      break
    }

    if (maxMessages > 1 && i < maxMessages - 1) await (recipient.isGroup ? randDelayGroup() : randDelayClient())
  }

  return { processed, errors }
}
