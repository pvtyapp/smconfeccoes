import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"

// Grupo "SM Marketplaces" — recebe aviso colado manualmente aqui (análise
// roda fora do sistema, num agente com cron no PC, sem precisar subir pro
// Git/Vercel). Sempre pela instância admin dedicada, nunca a comercial.
const MARKETPLACE_GROUP_JID = "120363429813396969@g.us"

export async function POST(req: Request) {
  try {
    const { text } = await req.json() as { text?: string }
    if (!text?.trim()) {
      return NextResponse.json({ error: "Texto vazio" }, { status: 400 })
    }

    const instance = await getAdminInstanceName()
    if (!instance) {
      return NextResponse.json({ error: "Instância admin (sm-admin) não configurada" }, { status: 500 })
    }

    await sendWhatsApp(MARKETPLACE_GROUP_JID, text.trim(), undefined, instance)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
