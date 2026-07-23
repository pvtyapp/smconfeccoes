import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Retoma envio pausado por queda de conexão (pause_reason='disconnected').
// Pausa por lote (batch_cooldown) não passa por aqui — ela mesma libera sozinha
// quando paused_until expira, o operador não precisa fazer nada.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { action } = await req.json() as { action?: string }
    if (action !== "resume") return NextResponse.json({ error: "action inválida" }, { status: 400 })

    await pool.query(
      `UPDATE marketing_campaigns SET pause_reason = NULL, paused_until = NULL
       WHERE id = $1 AND pause_reason = 'disconnected'`,
      [id]
    )
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
    await pool.query(
      `UPDATE marketing_campaigns
       SET status = 'cancelled', executed_at = NOW()
       WHERE id = $1 AND status IN ('scheduled', 'sending', 'generating')`,
      [id]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
