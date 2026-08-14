import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { buildMatchKey } from "@/lib/marketplaceMatchKey"

type ConfirmRow = {
  variantId: string; qty: number; source: "regra" | "ia" | "memoria" | "manual"
  sku: string; variacao: string; isKit: boolean; qtyPerKit: number
}
type NewAssociation = { prefix: string; productId: string; color: string }

// Confirma a separação: grava o registro (marketplace_separations + items) e
// desconta do estoque de verdade via stock_movements — mesma tabela que
// produção/Kanban usam, só com reason/channel próprios pra não se misturar
// com vendas no Mapa da Operação e nos relatórios (ver GET /api/producao/mapa).
export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const { origin, rows, newAssociations } = await req.json() as {
      origin?: string; rows?: ConfirmRow[]; newAssociations?: NewAssociation[]
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Nenhum item pra confirmar" }, { status: 400 })
    }
    if (rows.some(r => !r.variantId || !r.qty || r.qty <= 0)) {
      return NextResponse.json({ error: "Item com variante ou quantidade inválida" }, { status: 400 })
    }

    await client.query("BEGIN")

    const numRes = await client.query(
      `SELECT 'MKT-' || LPAD(nextval('marketplace_separation_seq')::text, 4, '0') AS num`
    )
    const number = numRes.rows[0].num as string
    // "Itens" = linhas do pedido, não peça de kit expandida — mesma conta que
    // a tela de conferência usa (grupo de kit conta 1x, não 1x por peça).
    // Bug antigo: contava rows.length direto, ou seja cada peça de kit
    // dobrava o total (56 em vez de 33 numa lista real de teste).
    const kitLinesSeen = new Set(rows.filter(r => r.isKit).map(r => r.sku))
    const nonKitLines = rows.filter(r => !r.isKit).length
    const totalItems = kitLinesSeen.size + nonKitLines
    const totalPieces = rows.reduce((s, r) => s + r.qty, 0)

    const sepRes = await client.query(`
      INSERT INTO marketplace_separations (number, origin, total_items, total_pieces)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [number, origin ?? "manual", totalItems, totalPieces])
    const separationId = sepRes.rows[0].id

    for (const r of rows) {
      await client.query(`
        INSERT INTO marketplace_separation_items (separation_id, variant_id, qty, source)
        VALUES ($1, $2, $3, $4)
      `, [separationId, r.variantId, r.qty, r.source ?? "manual"])

      await client.query(`
        INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes)
        VALUES ($1, 'out', $2, 'marketplace_separacao', 'marketplace', $3)
      `, [r.variantId, r.qty, `Separação ${number}`])
    }

    if (newAssociations?.length) {
      for (const a of newAssociations) {
        if (!a.prefix?.trim() || !a.productId || !a.color?.trim()) continue
        await client.query(`
          INSERT INTO marketplace_sku_associations (prefix, product_id, color, origin)
          VALUES ($1, $2, $3, 'manual')
          ON CONFLICT (prefix) DO NOTHING
        `, [a.prefix.trim().toUpperCase(), a.productId, a.color.trim()])
      }
    }

    // Memória de SKU exato — grava/atualiza só aqui (nunca no momento do match
    // da IA), porque até confirmar a linha ainda passou pela revisão humana.
    //
    // Chave = SKU + Variação, não SKU sozinho: testado com picklist real, o
    // mesmo SKU do anúncio apareceu repetido apontando pra cor/tamanho
    // diferentes em cada linha (vendedor reaproveita 1 SKU pra todas as
    // variações do produto) — SKU sozinho memorizaria a variante errada pras
    // outras ocorrências. Ver lib/marketplaceMatchKey.
    //
    // Agrupa por chave: kit grava as N peças juntas, sobrescrevendo o que tinha
    // antes (autocorrige se o vendedor reaproveitar a mesma combinação depois).
    const byKeyGroup = new Map<string, { sku: string; rows: ConfirmRow[] }>()
    for (const r of rows) {
      if (!r.sku?.trim()) continue
      const key = buildMatchKey(r.sku, r.variacao ?? "")
      if (!byKeyGroup.has(key)) byKeyGroup.set(key, { sku: r.sku.trim(), rows: [] })
      byKeyGroup.get(key)!.rows.push(r)
    }

    if (byKeyGroup.size > 0) {
      const allVariantIds = [...new Set(rows.map(r => r.variantId))]
      const { rows: variantProductRows } = await client.query(`
        SELECT id AS "variantId", product_id AS "productId" FROM product_variants WHERE id = ANY($1::uuid[])
      `, [allVariantIds])
      const productIdByVariant = new Map<string, string>(
        (variantProductRows as { variantId: string; productId: string }[]).map(v => [v.variantId, v.productId])
      )

      for (const [matchKey, { sku, rows: group }] of byKeyGroup) {
        const isKit = group.some(r => r.isKit)
        const confirmedBy = group.some(r => r.source === "manual") ? "user_edit" : "ai_auto"

        // A mesma combinação SKU+Variação pode aparecer em mais de uma linha
        // do picklist (ex: o mesmo anúncio pedido 2x, listado em linhas
        // separadas) — sem isso, cada ocorrência somaria peças duplicadas na
        // memória e dobraria a dedução (ou o kit) na próxima leitura.
        // Composição é um SET de variantes, não uma lista por ocorrência: 1
        // item por variantId distinto.
        const uniqueItems = new Map<string, ConfirmRow>()
        for (const r of group) if (!uniqueItems.has(r.variantId)) uniqueItems.set(r.variantId, r)

        const { rows: matchRows } = await client.query(`
          INSERT INTO marketplace_sku_matches (sku, match_key, is_kit, confirmed_by, times_used, updated_at, last_used_at)
          VALUES ($1, $2, $3, $4, 1, now(), now())
          ON CONFLICT (match_key) DO UPDATE SET
            sku = EXCLUDED.sku, is_kit = EXCLUDED.is_kit, confirmed_by = EXCLUDED.confirmed_by,
            times_used = marketplace_sku_matches.times_used + 1, updated_at = now(), last_used_at = now()
          RETURNING id
        `, [sku, matchKey, isKit, confirmedBy])
        const matchId = matchRows[0].id

        await client.query(`DELETE FROM marketplace_sku_match_items WHERE match_id = $1`, [matchId])
        for (const r of uniqueItems.values()) {
          const productId = productIdByVariant.get(r.variantId)
          if (!productId) continue
          await client.query(`
            INSERT INTO marketplace_sku_match_items (match_id, product_id, variant_id, qty_per_kit)
            VALUES ($1, $2, $3, $4)
          `, [matchId, productId, r.variantId, r.qtyPerKit || 1])
        }
      }
    }

    await client.query("COMMIT")

    // Detalhe pra folha de separação (impressão) — busca nome/cor/tamanho pra exibir
    const { rows: itemsDetail } = await pool.query(`
      SELECT p.name AS "productName", pv.color, pv.size, pv.sku, msi.qty
      FROM marketplace_separation_items msi
      JOIN product_variants pv ON pv.id = msi.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE msi.separation_id = $1
      ORDER BY p.name, pv.color, pv.size
    `, [separationId])

    return NextResponse.json({ number, totalItems, totalPieces, items: itemsDetail })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    console.error("POST /api/marketplace/confirm:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
