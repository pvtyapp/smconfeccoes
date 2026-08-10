import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { evolutionProvider } from "@/lib/whatsapp/provider/evolutionProvider"

// PATCH — liga/desliga um número sem apagar o cadastro (útil pra tirar um
// número do rodízio temporariamente, ex: vai trocar de chip).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { active } = await req.json() as { active: boolean }
    await pool.query(`UPDATE marketing_instances SET active = $1 WHERE id = $2`, [active, id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE — remove o cadastro daqui E apaga a instância de verdade no Evolution.
// Antes só tirava daqui, deixando a sessão viva (ou meio-viva) lá — número
// re-reconectado com nome novo podia entrar em conflito de sessão com a
// instância fantasma esquecida (2 sessões pro mesmo WhatsApp = WhatsApp
// derruba uma com "device_removed"). Ver caso "portugal" x "1", 2026-08-10.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`SELECT instance_name FROM marketing_instances WHERE id = $1`, [id])
    if (rows[0]?.instance_name) {
      await evolutionProvider.deleteInstance(rows[0].instance_name)
    }
    await pool.query(`DELETE FROM marketing_instances WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
