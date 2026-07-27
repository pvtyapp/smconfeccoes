import { NextResponse } from "next/server"
import { wppconnectProvider } from "@/lib/whatsapp/provider/wppconnectProvider"

// QR code de reconexão pra qualquer sessão (principal ou comercial) — só
// serve pra sessão que já existe e caiu. Pra número novo, ver
// POST /api/marketing/instances (cria a sessão e já devolve o QR junto).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const instanceName = searchParams.get("instanceName")
  if (!instanceName?.trim()) {
    return NextResponse.json({ error: "instanceName obrigatório" }, { status: 400 })
  }

  const { base64, state } = await wppconnectProvider.getQrCode(instanceName.trim())
  return NextResponse.json({ base64, state, connected: state === "open" })
}
