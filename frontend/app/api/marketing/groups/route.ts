import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT jid, name
      FROM wa_groups
      ORDER BY name ASC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE /api/marketing/groups?jid=... — remove grupo fantasma (ex: renomeado/
// removido no WhatsApp mas que ficou em wa_groups)
export async function DELETE(req: Request) {
  const jid = new URL(req.url).searchParams.get("jid")
  if (!jid) return NextResponse.json({ error: "jid é obrigatório" }, { status: 400 })
  try {
    await pool.query(`DELETE FROM wa_groups WHERE jid = $1`, [jid])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
