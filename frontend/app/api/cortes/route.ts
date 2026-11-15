import { NextResponse } from "next/server"
import { listarCortes } from "@/lib/cortes"

// Lista dos cortes pra tela de aprovação (/dashboard/cortes). Precisa de login (middleware).
export async function GET() {
  try {
    return NextResponse.json({ cortes: await listarCortes(150) })
  } catch (e) {
    console.error("[cortes] GET", e)
    return NextResponse.json({ error: "Não consegui carregar os cortes" }, { status: 500 })
  }
}
