import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Reenvia UMA vez (nunca mais que isso) mensagem automática que falhou de
// verdade (status='failed', confirmado pelo messages.update real da Evolution
// — não é suposição). Espera pelo menos 30min desde a falha antes de tentar,
// pra não insistir em cima de um engasgo passageiro que ainda não se resolveu,
// e não olha falha com mais de 24h (provavelmente sessão realmente quebrada,
// tipo o caso do Pedro — retentar não ia ajudar e só reforça o problema).
// retried_at marca que já teve sua única chance, sucesso ou não.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await pool.query(`ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS retried_at TIMESTAMPTZ`).catch(() => {})

  // "resent" = Evolution aceitou de novo (status volta pra 'sent', pendente do
  // ACK real chegar depois) — não é garantia de entrega, só de reenvio aceito.
  const results = { retried: 0, resent: 0, failedAgain: 0 }

  const { rows } = await pool.query(`
    SELECT wm.id, wm.contact_id, wm.content, wc.jid
    FROM wa_messages wm
    JOIN wa_contacts wc ON wc.id = wm.contact_id
    WHERE wm.direction = 'out' AND wm.status = 'failed' AND wm.retried_at IS NULL
      AND wm.updated_at < NOW() - INTERVAL '30 minutes'
      AND wm.updated_at > NOW() - INTERVAL '24 hours'
    ORDER BY wm.updated_at ASC
    LIMIT 15
  `)

  for (const row of rows) {
    try {
      const result = await sendWhatsApp(row.jid, row.content) as { key?: { id?: string } }
      const newMsgId = result?.key?.id ?? null
      await pool.query(
        `UPDATE wa_messages SET retried_at = NOW(), message_id = COALESCE($1, message_id), status = 'sent', updated_at = NOW()
         WHERE id = $2`,
        [newMsgId, row.id]
      )
      results.retried++
      results.resent++
    } catch (e) {
      await pool.query(`UPDATE wa_messages SET retried_at = NOW() WHERE id = $1`, [row.id]).catch(() => {})
      results.retried++
      results.failedAgain++
      console.error("[retry-failed] falhou de novo:", row.contact_id, e instanceof Error ? e.message : e)
    }
    await sleep(2000 + Math.random() * 3000)
  }

  return NextResponse.json({ ok: true, ...results })
}
