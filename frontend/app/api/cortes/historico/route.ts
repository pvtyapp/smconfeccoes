import { NextResponse } from "next/server"
import { historicoCortes, proporcoes } from "@/lib/cortes"

// Histórico de custo (aba Histórico em /dashboard/cortes): cortes aprovados de `de` a `ate`
// (a tela já pede desde o início do período anterior, pra comparação) + a proporção por
// tamanho de cada produto aprendida até `ate`. Precisa de login (middleware).
const DATA = /^\d{4}-\d{2}-\d{2}$/
export async function GET(req: Request) {
  const u = new URL(req.url)
  const de = u.searchParams.get("de") ?? ""
  const ate = u.searchParams.get("ate") ?? ""
  if (!DATA.test(de) || !DATA.test(ate)) return NextResponse.json({ error: "Período inválido" }, { status: 400 })
  try {
    const [cortes, props] = await Promise.all([historicoCortes(de, ate), proporcoes(ate)])
    return NextResponse.json({ cortes, proporcoes: props })
  } catch (e) {
    console.error("[cortes/historico] GET", e)
    return NextResponse.json({ error: "Não consegui carregar o histórico" }, { status: 500 })
  }
}
