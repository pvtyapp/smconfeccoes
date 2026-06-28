import { list, del } from "@vercel/blob"
import { pool } from "@/lib/db"

export async function deleteBlobs(urls: string[]): Promise<void> {
  if (!urls.length) return
  await del(urls).catch(() => {})
}

/**
 * Called when a DTF pedido is concluded/cancelled.
 * Deletes DTF blobs for messages sent up to 7 days after the pedido was created.
 */
export async function cleanDtfBlobsOnConclude(
  contactId: number,
  pedidoCreatedAt: Date
): Promise<void> {
  const cutoff = new Date(pedidoCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  const { rows } = await pool.query<{ id: number; media_url: string }>(
    `SELECT id, media_url FROM wa_messages
     WHERE contact_id = $1
       AND media_category = 'dtf'
       AND media_url LIKE 'https://%'
       AND created_at < $2`,
    [contactId, cutoff.toISOString()]
  )
  if (!rows.length) return
  await deleteBlobs(rows.map(r => r.media_url))
  await pool.query(
    `UPDATE wa_messages SET media_url = NULL WHERE id = ANY($1)`,
    [rows.map(r => r.id)]
  )
}

/**
 * Limpa blobs de pedidos DTF em status 'orcamento' há mais de 60 dias sem atualização.
 */
export async function cleanAbandonedDtfOrcamento(): Promise<number> {
  let deleted = 0
  try {
    const { rows } = await pool.query<{ id: number; blob_url: string }>(
      `SELECT a.id, a.blob_url
       FROM dtf_order_attachments a
       JOIN dtf_pedidos p ON p.id = a.pedido_id
       WHERE p.status = 'orcamento'
         AND a.blob_url LIKE 'https://%'
         AND p.updated_at < NOW() - INTERVAL '60 days'`
    )
    if (!rows.length) return 0
    await deleteBlobs(rows.map(r => r.blob_url))
    await pool.query(
      `UPDATE dtf_order_attachments SET blob_url = NULL WHERE id = ANY($1)`,
      [rows.map(r => r.id)]
    )
    deleted = rows.length
  } catch (e) { console.error("[blobCleanup] abandonedDtfOrcamento falhou:", e) }
  return deleted
}

/**
 * Called by the daily cron — applies TTL per media category.
 * Returns number of blobs/rows cleaned.
 */
export async function runBlobTtlCleanup(): Promise<{ deleted: number }> {
  let deleted = 0

  // ── 1. wa_messages por categoria e TTL ───────────────────────────────────────
  const rules: { category: string; ttlDays: number }[] = [
    { category: "dtf",       ttlDays: 30 },
    { category: "foto",      ttlDays: 15 },
    { category: "video",     ttlDays: 15 },
    { category: "audio",     ttlDays: 15 },
    { category: "documento", ttlDays: 30 },
    { category: "sticker",   ttlDays: 7  },
    { category: "pix",       ttlDays: 30 },
  ]

  for (const { category, ttlDays } of rules) {
    const { rows } = await pool.query<{ id: number; media_url: string }>(
      `SELECT id, media_url FROM wa_messages
       WHERE media_category = $1
         AND media_url LIKE 'https://%'
         AND created_at < NOW() - make_interval(days => $2)`,
      [category, ttlDays]
    )
    if (!rows.length) continue
    await deleteBlobs(rows.map(r => r.media_url))
    await pool.query(
      `UPDATE wa_messages SET media_url = NULL WHERE id = ANY($1)`,
      [rows.map(r => r.id)]
    )
    deleted += rows.length
  }

  // ── 2. dtf_order_attachments em pedidos concluídos/cancelados há 30+ dias ────
  try {
    const { rows: dtfRows } = await pool.query<{ id: number; blob_url: string }>(
      `SELECT a.id, a.blob_url
       FROM dtf_order_attachments a
       JOIN dtf_pedidos p ON p.id = a.pedido_id
       WHERE p.status IN ('concluido', 'cancelado')
         AND a.blob_url LIKE 'https://%'
         AND p.updated_at < NOW() - INTERVAL '30 days'`
    )
    if (dtfRows.length) {
      await deleteBlobs(dtfRows.map(r => r.blob_url))
      await pool.query(
        `UPDATE dtf_order_attachments SET blob_url = NULL WHERE id = ANY($1)`,
        [dtfRows.map(r => r.id)]
      )
      deleted += dtfRows.length
    }
  } catch (e) { console.error("[blobCleanup] dtf_order_attachments falhou:", e) }

  // ── 3. Marketing blobs com mais de 60 dias ───────────────────────────────────
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    let cursor: string | undefined
    do {
      const { blobs, cursor: next } = await list({
        prefix: "sm-attachments/marketing/",
        cursor,
        limit: 100,
      })
      const old = blobs.filter(b => new Date(b.uploadedAt) < cutoff)
      if (old.length) {
        await del(old.map(b => b.url)).catch(() => {})
        deleted += old.length
      }
      cursor = next
    } while (cursor)
  } catch (e) { console.error("[blobCleanup] marketing falhou:", e) }

  // ── 4. Thumbnails base64 inline com 7+ dias (uploads que falharam) ───────────
  try {
    const { rows: b64Rows } = await pool.query<{ id: number }>(
      `SELECT id FROM wa_messages
       WHERE media_url LIKE 'data:%'
         AND created_at < NOW() - INTERVAL '7 days'`
    )
    if (b64Rows.length) {
      await pool.query(
        `UPDATE wa_messages SET media_url = NULL WHERE id = ANY($1)`,
        [b64Rows.map(r => r.id)]
      )
      deleted += b64Rows.length
    }
  } catch (e) { console.error("[blobCleanup] base64 inline falhou:", e) }

  return { deleted }
}
