import { NextResponse } from "next/server"
import { evolutionProvider } from "@/lib/whatsapp/provider/evolutionProvider"

const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Status do número principal — a instância Evolution de produção que atende
// chatbot, cobrança e lifecycle.
export async function GET() {
  if (!EVO_INSTANCE) {
    return NextResponse.json({ error: "EVOLUTION_INSTANCE não configurada" }, { status: 500 })
  }
  const { state, ok } = await evolutionProvider.getConnectionState(EVO_INSTANCE, 8_000)
  return NextResponse.json({
    instanceName: EVO_INSTANCE,
    state: ok ? state : null,
    connected: state === "open",
  })
}

// POST — pede um QR novo pra reconectar o principal (a instância já existe na
// Evolution, isso não cria nada — só reabre a sessão pra escanear de novo).
export async function POST() {
  if (!EVO_INSTANCE) {
    return NextResponse.json({ error: "EVOLUTION_INSTANCE não configurada" }, { status: 500 })
  }
  const { base64 } = await evolutionProvider.getQrCode(EVO_INSTANCE)
  return NextResponse.json({ qrcodeBase64: base64 })
}
