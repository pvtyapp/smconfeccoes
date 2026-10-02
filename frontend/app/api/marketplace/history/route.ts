import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/marketplace/history?from=YYYY-MM-DD&to=YYYY-MM-DD&loja=all|none|<id>
//
// Relatório de baixas: lista das separações do período (todas, sem LIMIT — antes
// cortava nas 50 últimas e escondia o resto) + quantidades unificadas por
// produto/cor/tamanho. Período pela data em horário de Brasília. `loja=none` são
// as separações antigas, de antes da tela de Lojas (loja_id NULL, só `origin`).
//
// Unificado soma por variante, então a mesma peça lançada em linhas diferentes
// (uma vinda de kit e outra avulsa, por ex.) vira um número só. Canceladas
// aparecem na lista mas nunca entram no unificado.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")
    const loja = searchParams.get("loja") ?? "all"
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (!from || !to || !dateRe.test(from) || !dateRe.test(to)) {
      return NextResponse.json({ error: "from e to (YYYY-MM-DD) são obrigatórios" }, { status: 400 })
    }

    const params: unknown[] = [from, to]
    let lojaCond = ""
    if (loja === "none") lojaCond = "AND ms.loja_id IS NULL"
    else if (loja !== "all") {
      const id = Number(loja)
      if (!Number.isInteger(id)) return NextResponse.json({ error: "loja inválida" }, { status: 400 })
      params.push(id)
      lojaCond = `AND ms.loja_id = $${params.length}`
    }
    const periodo = `DATE(ms.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1 AND $2`

    const [{ rows: separations }, { rows: consolidated }, { rows: legacy }] = await Promise.all([
      pool.query(`
        SELECT ms.id, ms.number, ms.origin, ms.loja_id AS "lojaId",
               COALESCE(ml.nome, ms.origin) AS "lojaNome",
               ms.total_items AS "totalItems", ms.total_pieces AS "totalPieces",
               ms.created_at AS "createdAt", ms.canceled_at AS "canceledAt"
        FROM marketplace_separations ms
        LEFT JOIN marketplace_lojas ml ON ml.id = ms.loja_id
        WHERE ${periodo} ${lojaCond}
        ORDER BY ms.created_at DESC
      `, params),
      pool.query(`
        SELECT pv.product_id AS "productId", p.name AS "productName",
               pv.color, pv.size, SUM(msi.qty)::int AS qty
        FROM marketplace_separations ms
        JOIN marketplace_separation_items msi ON msi.separation_id = ms.id
        JOIN product_variants pv ON pv.id = msi.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE ms.canceled_at IS NULL AND ${periodo} ${lojaCond}
        GROUP BY pv.product_id, p.name, pv.color, pv.size
        ORDER BY p.name, pv.color
      `, params),
      // Só pra saber se a opção "Antigas (sem loja)" faz sentido no filtro.
      pool.query(`SELECT EXISTS (SELECT 1 FROM marketplace_separations WHERE loja_id IS NULL) AS "hasLegacy"`),
    ])

    return NextResponse.json({ separations, consolidated, hasLegacy: legacy[0]?.hasLegacy === true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
