import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { isNfeEligible } from "@/lib/portal/fiscalCompleteness"

function periodBounds(period: string, from: string | null, to: string | null): { from: Date; to: Date } | null {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  switch (period) {
    case "hoje": return { from: startOfDay(now), to: endOfDay(now) }
    case "ontem": {
      const y = new Date(now); y.setDate(y.getDate() - 1)
      return { from: startOfDay(y), to: endOfDay(y) }
    }
    case "7d": { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: startOfDay(d), to: endOfDay(now) } }
    case "15d": { const d = new Date(now); d.setDate(d.getDate() - 15); return { from: startOfDay(d), to: endOfDay(now) } }
    case "30d": { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: startOfDay(d), to: endOfDay(now) } }
    case "custom": {
      if (!from || !to) return null
      const f = new Date(from); const t = new Date(to)
      if (isNaN(f.getTime()) || isNaN(t.getTime())) return null
      return { from: startOfDay(f), to: endOfDay(t) }
    }
    default: return null
  }
}

export async function GET(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const period = searchParams.get("period") ?? "7d"
  const bounds = periodBounds(period, searchParams.get("from"), searchParams.get("to"))
  if (!bounds) return NextResponse.json({ error: "Período inválido" }, { status: 400 })

  const { rows: contactRows } = await pool.query(
    `SELECT tipo_pessoa AS "tipoPessoa", regime_tributario AS "regimeTributario" FROM wa_contacts WHERE id = $1`,
    [session.contactId]
  )
  const contact = contactRows[0]
  const nfeEligible = contact ? isNfeEligible(contact) : false

  const { rows: orders } = await pool.query(`
    SELECT
      o.id, o.number, o.status, o.total_value AS "totalValue", o.created_at AS "createdAt",
      (
        SELECT fn.status FROM fiscal_note_orders fno
        JOIN fiscal_notes fn ON fn.id = fno.fiscal_note_id
        WHERE fno.order_id = o.id AND fn.status != 'rejeitada'
        ORDER BY fn.id DESC LIMIT 1
      ) AS "fiscalNoteStatus"
    FROM orders o
    WHERE o.contact_id = $1 AND o.status != 'cancelado'
      AND o.created_at BETWEEN $2 AND $3
    ORDER BY o.created_at DESC
  `, [session.contactId, bounds.from.toISOString(), bounds.to.toISOString()])

  return NextResponse.json({
    nfeEligible,
    tipoPessoa: contact?.tipoPessoa ?? null,
    regimeTributario: contact?.regimeTributario ?? null,
    orders,
  })
}
