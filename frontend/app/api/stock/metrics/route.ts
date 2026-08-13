import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

function weekSeg(day: number): 1 | 2 | 3 | 4 {
  if (day <= 7)  return 1
  if (day <= 14) return 2
  if (day <= 21) return 3
  return 4
}

// Days in a given week segment for a specific month
function segDays(seg: number, yr: number, mo: number): number {
  if (seg <= 3) return 7
  return Math.max(1, new Date(yr, mo, 0).getDate() - 21)
}

// Days elapsed so far in the current segment
function elapsedInSeg(seg: number, day: number): number {
  if (seg === 1) return day
  if (seg === 2) return day - 7
  if (seg === 3) return day - 14
  return day - 21
}

export async function GET() {
  try {
    // Current date in Brasília — use Intl to handle DST correctly
    const nowBRT_str  = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) // YYYY-MM-DD
    const [currentYr, currentMo, currentDay] = nowBRT_str.split("-").map(Number)
    const currentSeg = weekSeg(currentDay)
    const elapsed    = Math.max(1, elapsedInSeg(currentSeg, currentDay))

    const prevMo = currentMo === 1 ? 12 : currentMo - 1
    const prevYr = currentMo === 1 ? currentYr - 1 : currentYr

    const [{ rows: bal }, { rows: wk }] = await Promise.all([
      // Balance: current stock + 30d sales
      pool.query(`
        SELECT
          pv.id            AS "variantId",
          pv.product_id    AS "productId",
          p.name           AS "productName",
          pv.color,
          pv.size,
          pv.sku,
          pv.min_stock     AS "minStock",
          pv.target_stock  AS "targetStock",
          p.material_cost  AS "costPrice",
          COALESCE(b.qty, 0)::int   AS "currentStock",
          COALESCE(s30.qty, 0)::int AS "sales30d"
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN (
          SELECT variant_id, SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END) qty
          FROM stock_movements GROUP BY variant_id
        ) b ON b.variant_id = pv.id
        LEFT JOIN (
          SELECT variant_id, SUM(quantity) qty
          FROM stock_movements
          WHERE type='out' AND reason != 'manutencao' AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY variant_id
        ) s30 ON s30.variant_id = pv.id
        WHERE pv.status='active' AND p.status='active'
        ORDER BY p.name, pv.color, array_position(p.size_list, pv.size)
      `),
      // Weekly sales breakdown — last 4 months
      pool.query(`
        SELECT
          sm.variant_id AS "variantId",
          EXTRACT(YEAR  FROM (sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'))::int AS yr,
          EXTRACT(MONTH FROM (sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'))::int AS mo,
          CASE
            WHEN EXTRACT(DAY FROM (sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')) <= 7  THEN 1
            WHEN EXTRACT(DAY FROM (sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')) <= 14 THEN 2
            WHEN EXTRACT(DAY FROM (sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')) <= 21 THEN 3
            ELSE 4
          END::int AS seg,
          SUM(sm.quantity)::int AS qty
        FROM stock_movements sm
        JOIN product_variants pv ON pv.id = sm.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE sm.type='out'
          AND sm.reason != 'manutencao'
          AND pv.status='active' AND p.status='active'
          AND sm.created_at >= NOW() - INTERVAL '4 months'
        GROUP BY sm.variant_id, yr, mo, seg
      `),
    ])

    type WkRow = { variantId: string; yr: number; mo: number; seg: number; qty: number }
    const wkMap = new Map<string, WkRow[]>()
    for (const r of wk as WkRow[]) {
      if (!wkMap.has(r.variantId)) wkMap.set(r.variantId, [])
      wkMap.get(r.variantId)!.push(r)
    }

    const BUFFER = 3

    const variants = (bal as any[]).map(v => {
      const rows = wkMap.get(v.variantId) ?? []

      // Current week velocity (partial — use elapsed days so far)
      const curRow = rows.find(r => r.yr === currentYr && r.mo === currentMo && r.seg === currentSeg)
      const velocityCurrent = (curRow?.qty ?? 0) / elapsed

      // Same week segment, previous month (full segment)
      const prevRow = rows.find(r => r.yr === prevYr && r.mo === prevMo && r.seg === currentSeg)
      const prevDays = segDays(currentSeg, prevYr, prevMo)
      const velocityPrevMonth = prevRow ? prevRow.qty / prevDays : 0

      // Trend vs same period last month
      const trendPct = velocityPrevMonth > 0
        ? Math.round(((velocityCurrent - velocityPrevMonth) / velocityPrevMonth) * 100)
        : null

      // 30d baseline velocity
      const vel30d = v.sales30d / 30

      // Historical week pattern (skip current partial segment of current month)
      const pattern = ([1, 2, 3, 4] as const).map(seg => {
        const segRows = rows.filter(r =>
          r.seg === seg && !(r.yr === currentYr && r.mo === currentMo && r.seg === currentSeg)
        )
        if (!segRows.length) return { seg, vel: 0, n: 0 }
        const qty  = segRows.reduce((s, r) => s + r.qty, 0)
        const days = segRows.reduce((s, r) => s + segDays(r.seg, r.yr, r.mo), 0)
        return { seg, vel: days > 0 ? Math.round((qty / days) * 10) / 10 : 0, n: segRows.length }
      })

      // Next segment's expected velocity
      const nextSeg = (currentSeg === 4 ? 1 : currentSeg + 1) as 1 | 2 | 3 | 4
      const nextVel = pattern.find(p => p.seg === nextSeg)?.vel ?? 0

      const daysCurrent = velocityCurrent > 0 ? Math.round((v.currentStock / velocityCurrent) * 10) / 10 : null
      const daysNext    = nextVel > 0 ? Math.round((v.currentStock / nextVel) * 10) / 10 : null

      const growing   = trendPct !== null && trendPct > 15
      const declining = trendPct !== null && trendPct < -15

      // Effective days: adjust for trend direction.
      // Growing → stock will run out faster than it appears (multiply down).
      // Declining → stock will last longer than it appears (multiply up).
      const effectiveDays = daysCurrent !== null
        ? (growing ? daysCurrent * 0.8 : declining ? daysCurrent * 1.25 : daysCurrent)
        : null

      // Internal urgency matrix: stock urgency × trend direction. Kept as its
      // own 5-way read so suggestedProduction below can still tell "attention"
      // from a merely-healthy "ok" — only the value returned to the client
      // collapses to 3 stages (urgent/monitor/parado) right before the return.
      let priorityInternal: string
      if (v.sales30d === 0 && velocityCurrent === 0) {
        priorityInternal = "stopped"
      } else if (effectiveDays !== null && effectiveDays <= BUFFER) {
        // Critically low regardless of trend
        priorityInternal = "urgent"
      } else if (effectiveDays !== null && effectiveDays <= 5 && growing) {
        // Not yet critical but growing fast — will hit zero before you can produce
        priorityInternal = "urgent"
      } else if (effectiveDays !== null && effectiveDays <= 9) {
        priorityInternal = "attention"
      } else if (effectiveDays !== null && effectiveDays <= 14 && growing) {
        // Moderate stock but accelerating — plan ahead
        priorityInternal = "attention"
      } else if (effectiveDays !== null && effectiveDays > 30 && declining) {
        // Lots of stock AND losing traction → redirect capacity
        priorityInternal = "excess"
      } else if (v.targetStock > 0 && v.currentStock > v.targetStock * 2 && effectiveDays !== null && effectiveDays > 60) {
        priorityInternal = "excess"
      } else {
        priorityInternal = "ok"
      }
      const priority = priorityInternal === "urgent" ? "urgent"
        : priorityInternal === "attention" ? "monitor"
        : "parado" // ok | excess | stopped — same action either way: don't produce now

      // Production suggestion: smarter based on trend
      // Planning velocity = next period's expected rate (or current as fallback)
      const planningVel = Math.max(nextVel, vel30d * 0.7, velocityCurrent)
      const minBuffer   = Math.ceil(planningVel * BUFFER) // 3-day minimum stock
      const toMin       = Math.max(0, minBuffer - v.currentStock)
      const toTarget    = Math.max(0, v.targetStock - v.currentStock)

      let suggestedProduction = 0
      if (priority === "urgent" || priority === "monitor") {
        if (declining) {
          // Only refill to 3-day buffer — don't waste capacity filling to target
          suggestedProduction = toMin
        } else if (growing) {
          // Fill to target + 20% growth buffer
          suggestedProduction = Math.round(Math.max(toTarget, toMin) * 1.2)
        } else {
          suggestedProduction = Math.max(toTarget, toMin)
        }
      }

      return {
        variantId: v.variantId,
        productId: v.productId,
        productName: v.productName,
        color: v.color,
        size: v.size,
        sku: v.sku,
        minStock: v.minStock,
        targetStock: v.targetStock,
        currentStock: v.currentStock,
        sales30d: v.sales30d,
        velocityCurrent: Math.round(velocityCurrent * 10) / 10,
        velocityPrevMonth: Math.round(velocityPrevMonth * 10) / 10,
        vel30d: Math.round(vel30d * 10) / 10,
        trendPct,
        pattern,
        nextSeg,
        daysCurrent,
        daysNext,
        priority,
        suggestedProduction,
      }
    })

    return NextResponse.json({ currentSeg, currentDay, currentMo, currentYr, variants })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("GET /api/stock/metrics:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
