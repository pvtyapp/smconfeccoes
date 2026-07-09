import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/producao/mapa?dia=hoje|ontem
// Agrega tudo que o mapa isométrico de produção precisa mostrar — corte e
// revisão são sempre tempo real (não tem "ordem de ontem"), os outros 4
// setores (estoque, dtf, whatsapp, balcão) seguem o filtro de dia.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dia = searchParams.get("dia") === "ontem" ? "ontem" : "hoje"
    const offset = dia === "ontem" ? "1" : "0"

    // ── Corte: ordens de produção em andamento (ainda sendo cortadas) ────────
    const { rows: corte } = await pool.query(`
      SELECT
        po.id, po.number, po.product_name AS "productName", po.created_at AS "createdAt",
        COUNT(DISTINCT pom.id) AS "materiaisCount",
        COUNT(DISTINCT poi.color) AS "coresCount"
      FROM prod_orders po
      LEFT JOIN prod_order_materials pom ON pom.order_id = po.id
      LEFT JOIN prod_order_items     poi ON poi.order_id = po.id
      WHERE po.status = 'em_andamento'
      GROUP BY po.id, po.number, po.product_name, po.created_at
      ORDER BY po.created_at ASC
    `)

    // ── Revisão: já cortadas (concluida), ainda sem lote de revisão — fila de
    // prioridade pela mais antiga esperando primeiro ──────────────────────────
    const { rows: revisaoRows } = await pool.query(`
      SELECT po.id, po.number, po.product_name AS "productName", po.concluded_at AS "concludedAt"
      FROM prod_orders po
      WHERE po.status = 'concluida'
        AND NOT EXISTS (SELECT 1 FROM prod_revision_batches prb WHERE prb.order_id = po.id)
      ORDER BY po.concluded_at ASC
      LIMIT 3
    `)
    const PRIORIDADE_COR = ["vermelho", "amarelo", "verde"]
    const revisao = revisaoRows.map((r, i) => ({ ...r, prioridade: i + 1, cor: PRIORIDADE_COR[i] }))

    // ── Estoque: movimentações do dia (entrada = verde, saída = vermelho) ────
    const { rows: estoque } = await pool.query(`
      SELECT sm.id, sm.type, sm.quantity, sm.reason, sm.created_at AS "createdAt",
             p.name AS "productName", pv.color, pv.size
      FROM stock_movements sm
      JOIN product_variants pv ON pv.id = sm.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE - $1::int
      ORDER BY sm.created_at DESC
      LIMIT 60
    `, [offset])

    // ── DTF: vendas concluídas do dia ─────────────────────────────────────────
    const { rows: dtf } = await pool.query(`
      SELECT dp.id, dp.number, dp.preco_cobrado AS valor, dp.created_at AS "createdAt",
             COALESCE(c.name, dp.cliente) AS cliente
      FROM dtf_pedidos dp
      LEFT JOIN wa_contacts c ON c.id = dp.contact_id
      WHERE dp.status = 'concluido'
        AND DATE(dp.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE - $1::int
      ORDER BY dp.created_at DESC
      LIMIT 60
    `, [offset])

    // ── WhatsApp: pedidos de produto concluídos do dia (Autoatendimento) ─────
    const { rows: whatsapp } = await pool.query(`
      SELECT o.id, o.number, o.total_value AS valor, o.created_at AS "createdAt", c.name AS cliente
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.source = 'whatsapp' AND o.status = 'concluido'
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE - $1::int
      ORDER BY o.created_at DESC
      LIMIT 60
    `, [offset])

    // ── Balcão: vendas de PDV concluídas do dia ───────────────────────────────
    const { rows: balcao } = await pool.query(`
      SELECT o.id, o.number, o.total_value AS valor, o.created_at AS "createdAt"
      FROM orders o
      WHERE o.source = 'pdv' AND o.status = 'concluido'
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE - $1::int
      ORDER BY o.created_at DESC
      LIMIT 60
    `, [offset])

    return NextResponse.json({ dia, corte, revisao, estoque, dtf, whatsapp, balcao })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
