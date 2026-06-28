import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// GET /api/marketing/lifecycle?view=tasks|completed&period=today|7d|30d
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const view   = searchParams.get("view")   ?? "tasks"
  const period = searchParams.get("period") ?? "7d"

  try {
    if (view === "tasks") {
      const { rows } = await pool.query(`
        SELECT contact_id, name, phone, stage, due_at,
               (due_at < NOW()) AS overdue
        FROM (
          -- D2: novos que ainda não receberam mensagem
          SELECT
            c.id AS contact_id,
            c.name,
            c.phone,
            'D2' AS stage,
            (c.created_at + INTERVAL '2 days') AS due_at
          FROM wa_contacts c
          WHERE c.lifecycle_state = 'new'
            AND COALESCE(c.novo_seq, 0) = 0
            AND c.state = 'idle'

          UNION ALL

          -- D15: ativos com último pedido há mais de 13 dias (janela de 15d)
          SELECT
            c.id, c.name, c.phone,
            'D15',
            (c.last_order_at + INTERVAL '15 days')
          FROM wa_contacts c
          WHERE c.lifecycle_state = 'active'
            AND c.last_order_at IS NOT NULL

          UNION ALL

          -- D30: ausentes seq=1
          SELECT
            c.id, c.name, c.phone,
            'D30',
            (c.last_order_at + INTERVAL '30 days')
          FROM wa_contacts c
          WHERE c.lifecycle_state = 'ausente'
            AND COALESCE(c.ausente_seq, 0) = 1
            AND c.last_order_at IS NOT NULL

          UNION ALL

          -- D45: ausentes seq=2
          SELECT
            c.id, c.name, c.phone,
            'D45',
            (c.last_order_at + INTERVAL '45 days')
          FROM wa_contacts c
          WHERE c.lifecycle_state = 'ausente'
            AND COALESCE(c.ausente_seq, 0) = 2
            AND c.last_order_at IS NOT NULL
        ) sub
        ORDER BY overdue DESC, due_at ASC
      `)
      return NextResponse.json(rows)
    }

    // view === "completed"
    const intervals: Record<string, string> = {
      today: "1 day",
      "7d":  "7 days",
      "30d": "30 days",
    }
    const interval = intervals[period] ?? "7 days"

    const { rows } = await pool.query(`
      SELECT
        le.id,
        le.stage,
        le.sent_at AS "sentAt",
        le.status,
        c.name AS "contactName",
        c.phone
      FROM lifecycle_executions le
      JOIN wa_contacts c ON c.id = le.contact_id
      WHERE le.sent_at >= NOW() - INTERVAL '${interval}'
      ORDER BY le.sent_at DESC
      LIMIT 200
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
