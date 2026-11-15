import { NextResponse } from "next/server"
import { listarCortes, proporcoes } from "@/lib/cortes"

// Lista dos cortes pra tela de aprovação (/dashboard/cortes), com a proporção por tamanho de
// cada produto (custo por tamanho e alerta de desperdício). Precisa de login (middleware).
export async function GET() {
  try {
    const [cortes, props] = await Promise.all([listarCortes(150), proporcoes()])
    return NextResponse.json({ cortes, proporcoes: props })
  } catch (e) {
    console.error("[cortes] GET", e)
    return NextResponse.json({ error: "Não consegui carregar os cortes" }, { status: 500 })
  }
}
