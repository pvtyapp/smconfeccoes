import { Pool } from "pg"
import { pool } from "@/lib/db"

// Legacy stub — Vercel Blob removed. Kept for callers in delete-message and dtf/pedidos routes.
export async function deleteBlobs(_urls: string[]): Promise<void> {}

/**
 * Called when a DTF pedido concludes/cancels — NULLs media_data for that contact's
 * DTF messages in the 7-day window after pedido creation.
 */
export async function cleanDtfBlobsOnConclude(
  contactId: number,
  pedidoCreatedAt: Date
): Promise<void> {
  const cutoff = new Date(pedidoCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  await pool.query(
    `UPDATE wa_messages
     SET media_data = NULL
     WHERE contact_id = $1
       AND media_category = 'dtf'
       AND media_data IS NOT NULL
       AND created_at < $2`,
    [contactId, cutoff.toISOString()]
  ).catch(() => {})
}

/**
 * Called by the hourly cron. NULLs dtf_order_attachments.blob_url (base64, not a
 * real URL despite the column name) for pedidos concluded/cancelled >48h ago —
 * this table had no TTL at all and was the main driver of the 2026-07-21 disk-full
 * incident (2.2GB in 117 rows, ~18MB avg per attachment).
 */
export async function cleanDtfAttachments(): Promise<number> {
  try {
    const { rowCount } = await pool.query(`
      UPDATE dtf_order_attachments a
      SET blob_url = NULL
      FROM dtf_pedidos p
      WHERE a.pedido_id = p.id
        AND a.blob_url IS NOT NULL
        AND p.status IN ('concluido', 'cancelado')
        AND COALESCE(p.concluded_at, p.created_at) < NOW() - INTERVAL '48 hours'
    `)
    return rowCount ?? 0
  } catch (e) {
    console.error("[dtfAttachmentsCleanup]:", e)
    return 0
  }
}

/**
 * Called by the daily cron. PIV 31/10/2026: histórico de WhatsApp só das últimas 48h
 * ("se quiser mais, abre o WhatsApp") — corta o consumo do Postgres da SM no Railway.
 * 1. NULLs media_data older than 48h (TTL)
 * 2. Marks stuck media as failed (media_type set, media_data never arrived, > 2h old)
 * 3. Evicts oldest media_data if total > 500MB
 * 4. Deletes wa_messages, wa_group_messages and wa_ack_events older than 48h
 * 5. DTF attachments of concluded pedidos > 48h
 * 6. Evolution's own database (Message/MessageUpdate) older than 48h — o Evolution não apaga nada sozinho
 */
export async function runMediaCleanup(): Promise<{ mediaCleared: number; messagesDeleted: number; dtfAttachmentsCleared: number; evolutionDeleted: number }> {
  let mediaCleared  = 0
  let messagesDeleted = 0
  let dtfAttachmentsCleared = 0

  // 1. TTL 48h — NULL media_data, mark as failed
  try {
    const { rowCount } = await pool.query(`
      UPDATE wa_messages
      SET media_data = NULL, media_failed = true
      WHERE media_data IS NOT NULL
        AND created_at < NOW() - INTERVAL '48 hours'
    `)
    mediaCleared += rowCount ?? 0
  } catch (e) { console.error("[mediaCleanup] TTL 48h:", e) }

  // 2. Stuck media — never fetched, > 2h old → mark failed so front stops spinning
  try {
    await pool.query(`
      UPDATE wa_messages
      SET media_failed = true
      WHERE media_type IS NOT NULL
        AND media_data IS NULL
        AND COALESCE(media_failed, false) = false
        AND created_at < NOW() - INTERVAL '2 hours'
    `)
  } catch (e) { console.error("[mediaCleanup] stuck media:", e) }

  // 3. Size-based eviction — if > 500MB, evict oldest 100 at a time
  try {
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(LENGTH(media_data)), 0) AS total_bytes
      FROM wa_messages WHERE media_data IS NOT NULL
    `)
    const totalBytes = Number(rows[0]?.total_bytes ?? 0)
    if (totalBytes > 500 * 1024 * 1024) {
      const { rowCount } = await pool.query(`
        UPDATE wa_messages SET media_data = NULL, media_failed = true
        WHERE id IN (
          SELECT id FROM wa_messages
          WHERE media_data IS NOT NULL
          ORDER BY created_at ASC
          LIMIT 100
        )
      `)
      mediaCleared += rowCount ?? 0
    }
  } catch (e) { console.error("[mediaCleanup] evicção tamanho:", e) }

  // 4. Delete messages older than 48h (unlink DTF attachments first)
  try {
    await pool.query(`
      UPDATE dtf_order_attachments SET wa_message_id = NULL
      WHERE wa_message_id IN (
        SELECT id FROM wa_messages WHERE created_at < NOW() - INTERVAL '48 hours'
      )
    `)
    const { rowCount } = await pool.query(`
      DELETE FROM wa_messages WHERE created_at < NOW() - INTERVAL '48 hours'
    `)
    messagesDeleted = rowCount ?? 0
  } catch (e) { console.error("[mediaCleanup] delete mensagens antigas:", e) }

  // 4b. Grupos e confirmações de leitura nunca eram limpos (94 mil e 153 mil linhas em 31/10)
  for (const tabela of ["wa_group_messages", "wa_ack_events"]) {
    try {
      const { rowCount } = await pool.query(`DELETE FROM ${tabela} WHERE created_at < NOW() - INTERVAL '48 hours'`)
      messagesDeleted += rowCount ?? 0
    } catch (e) { console.error(`[mediaCleanup] delete ${tabela}:`, e) }
  }

  // 5. DTF attachments (dtf_order_attachments.blob_url) — pedidos concluídos/cancelados > 48h
  dtfAttachmentsCleared = await cleanDtfAttachments()

  // 6. Banco do Evolution
  const evolutionDeleted = await cleanEvolutionMessages()

  return { mediaCleared, messagesDeleted, dtfAttachmentsCleared, evolutionDeleted }
}

/**
 * O Evolution grava toda mensagem no banco próprio (`evolutiondb`, mesmo servidor Postgres da SM)
 * e nunca apaga: 384 mil mensagens desde maio, 870 MB em 31/10. A tela de Chat lê conversa e
 * grupo direto dele (findMessages), então isso também é o histórico da tela — 48h (PIV 31/10).
 * Apaga em lotes (a 1ª vez são ~380 mil) e as atualizações de status antes das mensagens.
 */
export async function cleanEvolutionMessages(): Promise<number> {
  const base = process.env.EVOLUTION_DATABASE_URL || process.env.DATABASE_URL
  if (!base) return 0
  const url = new URL(base)
  if (!process.env.EVOLUTION_DATABASE_URL) url.pathname = "/" + (process.env.EVOLUTION_DB_NAME || "evolutiondb")
  const evo = new Pool({ connectionString: url.toString(), ssl: base.includes("railway") ? { rejectUnauthorized: false } : false, max: 1 })
  let apagadas = 0
  try {
    const corte = Math.floor(Date.now() / 1000) - 48 * 3600
    await evo.query(`
      DELETE FROM "MessageUpdate" u
      WHERE NOT EXISTS (SELECT 1 FROM "Message" m WHERE m.id = u."messageId" AND m."messageTimestamp" >= $1)
    `, [corte])
    for (let lote = 0; lote < 100; lote++) {
      const { rowCount } = await evo.query(`
        DELETE FROM "Message" WHERE id IN (SELECT id FROM "Message" WHERE "messageTimestamp" < $1 LIMIT 20000)
      `, [corte])
      apagadas += rowCount ?? 0
      if (!rowCount || rowCount < 20000) break
    }
  } catch (e) {
    console.error("[evolutionCleanup]:", e instanceof Error ? e.message : e)
  } finally {
    await evo.end().catch(() => {})
  }
  return apagadas
}
