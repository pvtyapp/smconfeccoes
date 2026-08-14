import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Memória de SKU exato — lista pra tela de administração (ver o que foi
// aprendido e apagar entradas erradas na mão). Só leitura aqui; a gravação
// acontece em /api/marketplace/confirm, nunca por essa rota.
export async function GET() {
  try {
    const [{ rows: matches }, { rows: items }] = await Promise.all([
      pool.query(`
        SELECT id, sku, is_kit AS "isKit", confirmed_by AS "confirmedBy", times_used AS "timesUsed",
               created_at AS "createdAt", last_used_at AS "lastUsedAt"
        FROM marketplace_sku_matches
        ORDER BY last_used_at DESC
      `),
      pool.query(`
        SELECT mi.match_id AS "matchId", mi.qty_per_kit AS "qtyPerKit", mi.piece_label AS "pieceLabel",
               p.name AS "productName", pv.color, pv.size
        FROM marketplace_sku_match_items mi
        JOIN products p ON p.id = mi.product_id
        LEFT JOIN product_variants pv ON pv.id = mi.variant_id
      `),
    ])
    const itemsByMatch = new Map<number, typeof items>()
    for (const it of items) {
      if (!itemsByMatch.has(it.matchId)) itemsByMatch.set(it.matchId, [])
      itemsByMatch.get(it.matchId)!.push(it)
    }
    const result = matches.map(m => ({ ...m, items: itemsByMatch.get(m.id) ?? [] }))
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
