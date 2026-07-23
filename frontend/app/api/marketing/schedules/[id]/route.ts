import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json() as {
      active?: boolean
      name?: string
      daysOfWeek?: number[]
      timeOfDay?: string
      audienceType?: string
      audienceLifecycle?: string | null
      audienceGroupJids?: string[]
    }

    // Só atualiza os campos que vieram no body — o toggle de ligar/desligar
    // (usado pela tela toda vez que clica no botão) manda só {active}, e a
    // edição completa da programação manda todos os outros junto.
    const sets: string[] = []
    const vals: unknown[] = []
    function set(col: string, val: unknown) {
      vals.push(val)
      sets.push(`${col} = $${vals.length}`)
    }
    if (body.active !== undefined)            set("active", body.active)
    if (body.name !== undefined)               set("name", body.name)
    if (body.daysOfWeek !== undefined)         set("days_of_week", body.daysOfWeek)
    if (body.timeOfDay !== undefined)          set("time_of_day", body.timeOfDay)
    if (body.audienceType !== undefined)       set("audience_type", body.audienceType)
    if (body.audienceLifecycle !== undefined)  set("audience_lifecycle", body.audienceLifecycle)
    if (body.audienceGroupJids !== undefined)  set("audience_group_jids", body.audienceGroupJids)

    // Mesma trava da criação: se o horário está sendo alterado pra um que já
    // passou hoje, marca como "já executado hoje" pra não disparar na hora
    // de salvar a edição — só entra em vigor na próxima ocorrência.
    if (body.timeOfDay !== undefined) {
      const nowBR = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date())
      if (body.timeOfDay.slice(0, 5) <= nowBR) set("last_executed_at", new Date())
    }

    if (sets.length === 0) return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })

    vals.push(id)
    await pool.query(`UPDATE marketing_schedules SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query(`DELETE FROM marketing_schedules WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
