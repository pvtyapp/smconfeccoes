import { NextResponse } from "next/server"
import { getClientSessionFromRequest } from "@/lib/clientSession"

export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  return NextResponse.json({ name: session.name })
}
