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
 * Called by the hourly cron.
 * 1. NULLs media_data older than 48h (TTL)
 * 2. Marks stuck media as failed (media_type set, media_data never arrived, > 2h old)
 * 3. Evicts oldest media_data if total > 500MB
 * 4. Deletes wa_messages older than 14 days
 */
export async function runMediaCleanup(): Promise<{ mediaCleared: number; messagesDeleted: number }> {
  let mediaCleared  = 0
  let messagesDeleted = 0

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

  // 4. Delete messages older than 14 days (unlink DTF attachments first)
  try {
    await pool.query(`
      UPDATE dtf_order_attachments SET wa_message_id = NULL
      WHERE wa_message_id IN (
        SELECT id FROM wa_messages WHERE created_at < NOW() - INTERVAL '14 days'
      )
    `)
    const { rowCount } = await pool.query(`
      DELETE FROM wa_messages WHERE created_at < NOW() - INTERVAL '14 days'
    `)
    messagesDeleted = rowCount ?? 0
  } catch (e) { console.error("[mediaCleanup] delete mensagens antigas:", e) }

  return { mediaCleared, messagesDeleted }
}
