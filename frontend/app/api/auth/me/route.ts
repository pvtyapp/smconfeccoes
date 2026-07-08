import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifySession, COOKIE_NAME } from "@/lib/session"

export async function GET() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  return NextResponse.json({
    name: session.name,
    login: session.login,
    isAdmin: session.isAdmin,
    allowedPages: session.allowedPages,
  })
}
