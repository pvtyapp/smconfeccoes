import { NextResponse } from "next/server"
import { forceFechamentoIfPending } from "@/lib/whatsapp/financeiroFlow"

// Vercel Cron: 0 23 * * * (20h Brasília = 23h UTC) — prazo combinado: se
// ninguém respondeu a pergunta de despesa (ou o fluxo ficou parado no meio),
// força o fechamento sem despesa e limpa o estado. Se o grupo já respondeu e
// terminou o fluxo antes desse horário, forceFechamentoIfPending não faz nada
// (o fechamento já saiu na hora, disparado pelo próprio fluxo).
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await forceFechamentoIfPending()
  return NextResponse.json({ ok: true })
}
