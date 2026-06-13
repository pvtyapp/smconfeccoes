import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id, s.name, s.days_of_week AS "daysOfWeek",
        s.time_of_day::text AS "timeOfDay",
        s.audience_type AS "audienceType",
        s.audience_lifecycle AS "audienceLifecycle",
        s.audience_group_jids AS "audienceGroupJids",
        s.active, s.last_executed_at AS "lastExecutedAt",
        s.created_at AS "createdAt",
        COUNT(i.id)::int AS "itemCount"
      FROM marketing_schedules s
      LEFT JOIN marketing_schedule_items i ON i.schedule_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      name: string
      daysOfWeek: number[]
      timeOfDay: string
      audienceType: string
      audienceLifecycle?: string
      audienceGroupJids?: string[]
    }

    const { name, daysOfWeek, timeOfDay, audienceType, audienceLifecycle, audienceGroupJids } = body

    if (!name?.trim() || !timeOfDay) {
      return NextResponse.json({ error: "name e timeOfDay obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO marketing_schedules
        (name, days_of_week, time_of_day, audience_type, audience_lifecycle, audience_group_jids)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
    `, [
      name,
      daysOfWeek ?? [1,2,3,4,5],
      timeOfDay,
      audienceType ?? "groups",
      audienceLifecycle ?? null,
      audienceGroupJids ?? [],
    ])

    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
