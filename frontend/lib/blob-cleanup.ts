import { pool } from "@/lib/db"

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? ""

async function deleteBlobs(urls: string[]): Promise<void> {
  if (!urls.length || !BLOB_TOKEN) return
  await fetch("https://blob.vercel-storage.com/delete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls }),
  }).catch(() => {})
}

/**
 * Called when a DTF pedido is concluded/cancelled.
 * Deletes DTF blobs for messages sent up to 7 days after the pedido was created
 * (covers any revision files sent early in the order lifecycle).
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
    `UPDATE wa_messages SET media_url = '' WHERE id = ANY($1)`,
    [rows.map(r => r.id)]
  )
}

/**
 * Called by the daily cron — applies TTL per media category.
 * Returns number of blobs deleted.
 */
export async function runBlobTtlCleanup(): Promise<{ deleted: number }> {
  const rules: { category: string; ttlDays: number }[] = [
    { category: "dtf",       ttlDays: 30 },
    { category: "foto",      ttlDays: 15 },
    { category: "video",     ttlDays: 15 },
    { category: "audio",     ttlDays: 15 },
    { category: "documento", ttlDays: 30 },
    { category: "sticker",   ttlDays: 15 },
    { category: "pix",       ttlDays: 30 },
  ]

  let deleted = 0
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
      `UPDATE wa_messages SET media_url = '' WHERE id = ANY($1)`,
      [rows.map(r => r.id)]
    )
    deleted += rows.length
  }
  return { deleted }
}
