import { NextResponse } from "next/server"
import { wppconnectProvider } from "@/lib/whatsapp/provider/wppconnectProvider"

const SESSION = (process.env.WPPCONNECT_SESSION_NAME ?? "").trim()

// Status do número principal — hoje é a sessão de teste (WPPCONNECT_SESSION_NAME);
// quando o principal de produção migrar de verdade da Evolution pro WPPConnect
// (Fase 3/4), essa mesma rota passa a apontar pra sessão real, sem mudar o
// contrato pro frontend.
export async function GET() {
  if (!SESSION) {
    return NextResponse.json({ error: "WPPCONNECT_SESSION_NAME não configurada" }, { status: 500 })
  }
  const { state, ok } = await wppconnectProvider.getConnectionState(SESSION, 8_000)
  return NextResponse.json({
    instanceName: SESSION,
    state: ok ? state : null,
    connected: state === "open",
  })
}

// POST — inicia a sessão principal se ainda não estiver rodando.
export async function POST() {
  if (!SESSION) {
    return NextResponse.json({ error: "WPPCONNECT_SESSION_NAME não configurada" }, { status: 500 })
  }
  const result = await wppconnectProvider.createInstance(SESSION)
  return NextResponse.json(result)
}
