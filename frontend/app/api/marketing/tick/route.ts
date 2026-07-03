import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { campaignSend } from "@/lib/whatsapp/campaignSend"

type Recipient = { jid: string; id?: number; name: string; isGroup?: boolean }

export async function POST(req: Request) {
  try {
    const { campaignId } = await req.json() as { campaignId: number }
    if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT id, content, media_url, recipients_json, sent_count, total_count, status
       FROM marketing_campaigns WHERE id = $1`,
      [campaignId]
    )
    const camp = rows[0]

    if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 })

    if (camp.status !== "sending") {
      return NextResponse.json({ done: true, sentCount: camp.sent_count, totalCount: camp.total_count })
    }

    if (!camp.recipients_json) {
      await pool.query(`UPDATE marketing_campaigns SET status = 'sent', executed_at = NOW() WHERE id = $1`, [campaignId])
      return NextResponse.json({ done: true, sentCount: camp.sent_count, totalCount: camp.total_count })
    }

    const recipients = camp.recipients_json as Recipient[]
    const idx = camp.sent_count as number

    if (idx >= recipients.length) {
      await pool.query(`UPDATE marketing_campaigns SET status = 'sent', executed_at = NOW() WHERE id = $1`, [campaignId])
      return NextResponse.json({ done: true, sentCount: idx, totalCount: camp.total_count })
    }

    // Atomic claim — prevents duplicate sends if two ticks fire simultaneously
    const { rowCount } = await pool.query(
      `UPDATE marketing_campaigns SET sent_count = sent_count + 1
       WHERE id = $1 AND sent_count = $2 AND status = 'sending'`,
      [campaignId, idx]
    )
    if ((rowCount ?? 0) === 0) {
      return NextResponse.json({ done: false, sentCount: idx, totalCount: camp.total_count })
    }

    const recipient = recipients[idx]
    let hasError = false
    const mediaUrl = camp.media_url as string | null

    // Resolve real send JID — also guard optout and daily limit
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
      if (g?.optout) {
        await countDoneHelper(pool, campaignId, idx, camp.total_count as number, false)
        return NextResponse.json({ done: idx + 1 >= (camp.total_count as number), sentCount: idx + 1, totalCount: camp.total_count as number, skipped: "optout" })
      }
      if (g?.last_marketing_sent_at && (Date.now() - new Date(g.last_marketing_sent_at).getTime()) < 20 * 60 * 60 * 1000) {
        await countDoneHelper(pool, campaignId, idx, camp.total_count as number, false)
        return NextResponse.json({ done: idx + 1 >= (camp.total_count as number), sentCount: idx + 1, totalCount: camp.total_count as number, skipped: "daily_limit" })
      }
      if (g?.send_jid) sendJid = g.send_jid
    }

    // @lid without resolved JID — skip
    if (sendJid.endsWith("@lid")) {
      await countDoneHelper(pool, campaignId, idx, camp.total_count as number, false)
      return NextResponse.json({ done: idx + 1 >= (camp.total_count as number), sentCount: idx + 1, totalCount: camp.total_count as number, skipped: "lid_unresolved" })
    }

    try {
      const firstName = ((recipient.name as string | null) ?? "").split(" ")[0]
      const msg = recipient.isGroup
        ? (camp.content as string)
        : (camp.content as string).replace(/\{nome\}/g, firstName)

      try {
        await campaignSend(sendJid, msg, mediaUrl)
      } catch (mediaErr) {
        console.error("[campaign-tick] sendMedia falhou para", sendJid, "—", mediaErr instanceof Error ? mediaErr.message : mediaErr)
        if (mediaUrl) {
          // Fallback: enviar só o texto para o destinatário não ficar no vácuo
          try {
            await campaignSend(recipient.jid, msg, null)
          } catch (textErr) {
            console.error("[campaign-tick] fallback sendText também falhou para", recipient.jid, "—", textErr instanceof Error ? textErr.message : textErr)
            throw textErr
          }
        } else {
          throw mediaErr
        }
      }

      if (recipient.id) {
        await pool.query(`UPDATE wa_contacts SET last_marketing_sent_at = NOW() WHERE id = $1`, [recipient.id]).catch(() => {})
        await pool.query(
          `INSERT INTO wa_messages (contact_id, direction, content, media_url, media_type)
           VALUES ($1,'out',$2,$3,$4)`,
          [recipient.id, msg, mediaUrl ?? null, mediaUrl ? "image" : null]
        ).catch(() => {})
      }
    } catch (e) {
      console.error("[campaign-tick] erro final no recipient", recipient.jid, "—", e instanceof Error ? e.message : e)
      hasError = true
    }

    const newCount = idx + 1
    const isDone = newCount >= (camp.total_count as number)

    await pool.query(
      `UPDATE marketing_campaigns
       SET error_count = error_count + $1,
           status = CASE WHEN $2 THEN 'sent' ELSE status END,
           executed_at = CASE WHEN $2 THEN NOW() ELSE executed_at END
       WHERE id = $3`,
      [hasError ? 1 : 0, isDone, campaignId]
    )

    return NextResponse.json({ done: isDone, sentCount: newCount, totalCount: camp.total_count as number })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function countDoneHelper(
  db: typeof pool,
  campaignId: number,
  idx: number,
  total: number,
  hasError: boolean
) {
  const newCount = idx + 1
  const isDone   = newCount >= total
  await db.query(
    `UPDATE marketing_campaigns
     SET sent_count = $1, error_count = error_count + $2,
         status = CASE WHEN $3 THEN 'sent' ELSE status END,
         executed_at = CASE WHEN $3 THEN NOW() ELSE executed_at END
     WHERE id = $4`,
    [newCount, hasError ? 1 : 0, isDone, campaignId]
  ).catch(() => {})
}
