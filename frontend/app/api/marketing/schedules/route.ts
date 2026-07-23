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
        COUNT(i.id)::int AS "itemCount",
        (SELECT media_url FROM marketing_schedule_items
         WHERE schedule_id = s.id AND media_url IS NOT NULL
         ORDER BY id ASC LIMIT 1) AS "firstItemMediaUrl"
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

    // O cron considera a programação "atrasada" (dispara na próxima passada,
    // até 5min) quando time_of_day já passou hoje e ela nunca rodou ainda.
    // Sem isso, criar uma programação às 17h pro horário 09h disparava na
    // hora — em vez de só valer a partir do próximo dia configurado. Se o
    // horário escolhido ainda não chegou hoje, deixa null mesmo, pra poder
    // disparar hoje na hora certa.
    const nowBR = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date())
    const alreadyPassedToday = timeOfDay.slice(0, 5) <= nowBR

    const { rows } = await pool.query(`
      INSERT INTO marketing_schedules
        (name, days_of_week, time_of_day, audience_type, audience_lifecycle, audience_group_jids, last_executed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id
    `, [
      name,
      daysOfWeek ?? [1,2,3,4,5],
      timeOfDay,
      audienceType ?? "groups",
      audienceLifecycle ?? null,
      audienceGroupJids ?? [],
      alreadyPassedToday ? new Date() : null,
    ])

    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
