import { NextResponse } from "next/server"
import { list } from "@vercel/blob"
import { pool } from "@/lib/db"

type FolderStat = { folder: string; count: number; sizeBytes: number }

export async function GET() {
  try {
    // Count per-folder from Vercel Blob — sem filtro de prefixo, escaneia tudo
    // que existe no store (catalog/, hero-banners/, e qualquer outro que surgir),
    // agrupando pelo primeiro segmento do caminho.
    const folderMap: Record<string, FolderStat> = {}

    let cursor: string | undefined
    do {
      const { blobs, cursor: next } = await list({ cursor, limit: 1000 })
      for (const b of blobs) {
        const parts = b.pathname.split("/")
        const folder = parts.length >= 2 ? parts[0] : "root"
        if (!folderMap[folder]) folderMap[folder] = { folder, count: 0, sizeBytes: 0 }
        folderMap[folder].count++
        folderMap[folder].sizeBytes += b.size ?? 0
      }
      cursor = next
    } while (cursor)

    // wa_messages with blob vs base64 vs null (media_data column)
    const { rows: dbStats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE media_data LIKE 'https://%') AS blob_count,
        COUNT(*) FILTER (WHERE media_data LIKE 'data:%')   AS base64_count,
        COUNT(*) FILTER (WHERE media_data IS NULL AND media_type IS NOT NULL) AS missing_count
      FROM wa_messages
    `)

    const totalBytes = Object.values(folderMap).reduce((s, f) => s + f.sizeBytes, 0)

    return NextResponse.json({
      totalMB: (totalBytes / 1024 / 1024).toFixed(2),
      folders: Object.values(folderMap).sort((a, b) => b.sizeBytes - a.sizeBytes),
      db: dbStats[0],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
