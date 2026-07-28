import { NextResponse } from "next/server"
import { evolutionProvider } from "@/lib/whatsapp/provider/evolutionProvider"

// QR code de reconexão pra qualquer instância (principal ou comercial) — só
// serve pra instância que já existe e caiu. Pra número novo, ver
// POST /api/marketing/instances (cria a instância e já devolve o QR junto).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const instanceName = searchParams.get("instanceName")
  if (!instanceName?.trim()) {
    return NextResponse.json({ error: "instanceName obrigatório" }, { status: 400 })
  }

  const { base64, state } = await evolutionProvider.getQrCode(instanceName.trim())
  return NextResponse.json({ base64, state, connected: state === "open" })
}
