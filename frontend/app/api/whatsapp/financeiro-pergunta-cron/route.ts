import { NextResponse } from "next/server"
import { askDespesaQuestion } from "@/lib/whatsapp/financeiroFlow"

// Vercel Cron: 0 22 * * * (19h Brasília = 22h UTC) — pergunta se teve despesa
// variável hoje no grupo Financeiro. Ver /financeiro-fechamento-cron (~20h)
// pro prazo combinado: sem resposta até lá, o fechamento sai sem despesa.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await askDespesaQuestion()
  return NextResponse.json({ ok: true })
}
