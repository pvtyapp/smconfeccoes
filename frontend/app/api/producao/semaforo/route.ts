import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

type Status = "verde" | "amarelo" | "vermelho"

export async function GET() {
  try {
    // ── CORTE: ordens em_andamento ────────────────────────────────────────────
    const { rows: ordensCorte } = await pool.query(`
      SELECT
        po.id,
        po.number,
        po.product_name      AS "productName",
        po.created_at        AS "createdAt",
        COUNT(DISTINCT pom.id)                                      AS "materiaisCount",
        COUNT(poi.id) FILTER (WHERE poi.qty_planned > 0)            AS "itensPreenchidos",
        COUNT(poi.id)                                               AS "itensTotal",
        COALESCE(SUM(poi.qty_planned), 0)                           AS "totalPecas"
      FROM prod_orders po
      LEFT JOIN prod_order_materials pom ON pom.order_id = po.id
      LEFT JOIN prod_order_items     poi ON poi.order_id = po.id
      WHERE po.status = 'em_andamento'
      GROUP BY po.id, po.number, po.product_name, po.created_at
      ORDER BY po.created_at ASC
    `)

    let corteStatus: Status = "verde"
    const corteOrdens = ordensCorte.map(o => {
      const dias = Math.floor(
        (Date.now() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      return {
        number:      o.number      as string,
        productName: o.productName as string,
        totalPecas:  Number(o.totalPecas),
        semMaterial: Number(o.materiaisCount) === 0,
        diasAberto:  dias,
      }
    })

    if (ordensCorte.length > 0) {
      const temSemMaterial = corteOrdens.some(o => o.semMaterial)
      const temAtrasada    = corteOrdens.some(o => o.diasAberto > 7)
      const temSemGrade    = ordensCorte.some(o => Number(o.itensPreenchidos) === 0 && Number(o.itensTotal) > 0)

      if (temSemMaterial || temAtrasada) corteStatus = "vermelho"
      else if (temSemGrade)              corteStatus = "amarelo"
      else                               corteStatus = "verde"
    }

    const totalPecasCorte = corteOrdens.reduce((s, o) => s + o.totalPecas, 0)
    const corteLabel = ordensCorte.length === 0
      ? "Sem ordens ativas"
      : `${ordensCorte.length} ordem(ns) ativa(s) · ${totalPecasCorte} peças`

    // ── COSTURA: revisão dos últimos 30 dias ──────────────────────────────────
    const { rows: revRows } = await pool.query(`
      SELECT
        COALESCE(SUM(prb.qty_approved), 0) AS "totalAprovadas",
        COALESCE(SUM(prb.qty_defect),   0) AS "totalAvarias"
      FROM prod_revision_batches prb
      JOIN prod_orders po ON po.id = prb.order_id
      WHERE prb.concluded_at > NOW() - INTERVAL '30 days'
    `)

    const totalAprovadas = Number(revRows[0]?.totalAprovadas ?? 0)
    const totalAvarias   = Number(revRows[0]?.totalAvarias   ?? 0)
    const totalRevisado  = totalAprovadas + totalAvarias
    const pctDefect      = totalRevisado > 0
      ? Math.round((totalAvarias / totalRevisado) * 1000) / 10
      : 0

    // Ordens presas em produção há mais de 7 dias (sem revisão)
    const { rows: stalledRows } = await pool.query(`
      SELECT COUNT(*) AS count
      FROM prod_orders po
      WHERE po.status = 'em_andamento'
        AND po.created_at < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM prod_revision_batches prb
          WHERE prb.order_id = po.id
        )
    `)
    const stalledCount = Number(stalledRows[0]?.count ?? 0)

    let costuraStatus: Status = "verde"
    if (pctDefect > 15 || stalledCount > 0) costuraStatus = "vermelho"
    else if (pctDefect > 5)                 costuraStatus = "amarelo"

    const costuraLabel = totalRevisado === 0
      ? "Sem revisão nos últimos 30 dias"
      : `${totalAprovadas} aprovadas · ${totalAvarias} avarias (${pctDefect}%)`

    // ── ESTOQUE: variantes abaixo do mínimo ──────────────────────────────────
    const { rows: estoqueRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE bal < min_stock AND min_stock > 0) AS "abaixoMin",
        COUNT(*) FILTER (WHERE bal <= 0        AND min_stock > 0) AS "zerados",
        COUNT(*) FILTER (WHERE min_stock > 0)                     AS "comMinimo"
      FROM (
        SELECT
          pv.min_stock,
          COALESCE(SUM(CASE WHEN sm.type = 'in' THEN sm.quantity ELSE -sm.quantity END), 0) AS bal
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN stock_movements sm ON sm.variant_id = pv.id
        WHERE pv.status = 'active' AND p.status = 'active'
        GROUP BY pv.id, pv.min_stock
      ) sub
    `)

    const abaixoMin = Number(estoqueRows[0]?.abaixoMin ?? 0)
    const zerados   = Number(estoqueRows[0]?.zerados   ?? 0)

    let estoqueStatus: Status = "verde"
    if (zerados > 0 || abaixoMin >= 4) estoqueStatus = "vermelho"
    else if (abaixoMin > 0)            estoqueStatus = "amarelo"

    const estoqueLabel = abaixoMin === 0
      ? "Estoque OK"
      : `${abaixoMin} variante(s) abaixo do mínimo${zerados > 0 ? ` · ${zerados} zerada(s)` : ""}`

    return NextResponse.json({
      corte: {
        status: corteStatus,
        label:  corteLabel,
        count:  ordensCorte.length,
        ordens: corteOrdens,
      },
      costura: {
        status:          costuraStatus,
        label:           costuraLabel,
        totalAprovadas,
        totalAvarias,
        pctDefect,
        stalledCount,
      },
      estoque: {
        status:    estoqueStatus,
        label:     estoqueLabel,
        abaixoMin,
        zerados,
      },
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
