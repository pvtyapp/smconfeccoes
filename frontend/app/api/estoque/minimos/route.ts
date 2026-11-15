import { NextResponse } from "next/server"
import { saldosVariantes, salvarMinimos } from "@/lib/estoqueMinimo"

// Tela Estoque > Mínimo e alvo (PIV 14/11). Precisa de login (middleware).
// GET: todas as variantes ativas com disponível, vendas 30 dias, mínimo e alvo.
// POST: [{ variantId, minStock, targetStock }] grava de uma vez.
export async function GET() {
  try {
    return NextResponse.json({ variantes: await saldosVariantes() })
  } catch (e) {
    console.error("[estoque/minimos] GET", e)
    return NextResponse.json({ error: "Não consegui carregar o estoque" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { itens?: { variantId: string; minStock: number; targetStock: number }[] }
    if (!Array.isArray(body.itens) || body.itens.length > 2000) return NextResponse.json({ error: "Nada pra salvar" }, { status: 400 })
    return NextResponse.json({ ok: true, salvos: await salvarMinimos(body.itens) })
  } catch (e) {
    console.error("[estoque/minimos] POST", e)
    return NextResponse.json({ error: "Não consegui salvar, tenta de novo" }, { status: 500 })
  }
}
