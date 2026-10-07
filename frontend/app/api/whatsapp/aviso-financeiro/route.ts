import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"
import { FINANCEIRO_GROUP_JID } from "@/lib/whatsapp/financeiroGroup"

// Grupo "SM Financeiro" — mesmo esquema do aviso-marketplace: texto colado
// manualmente (o agente do outro PC monta a análise fora do sistema). Sempre
// pela instância admin dedicada. Não usa sendFinanceiro() porque ele engole o
// erro, e aqui a tela precisa saber se falhou.
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

    await sendWhatsApp(FINANCEIRO_GROUP_JID, text.trim(), undefined, instance)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
