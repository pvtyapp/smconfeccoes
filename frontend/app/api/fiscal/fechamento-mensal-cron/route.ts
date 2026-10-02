import { NextResponse } from "next/server"
import { enviarFechamentoMensal, mesAnteriorBrasilia } from "@/lib/fiscal/fechamentoMensal"

export const maxDuration = 300

// Vercel Cron: 30 3 1 * * (00h30 de Brasília do dia 01 = 03h30 UTC) — manda
// no grupo SM Administrativo o zip com as notas fiscais do mês anterior pro
// contador. ?mes=YYYY-MM força um mês específico (reenvio manual).
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { searchParams } = new URL(req.url)
  const mesParam = searchParams.get("mes")
  if (mesParam && !/^\d{4}-\d{2}$/.test(mesParam)) {
    return NextResponse.json({ error: "mes deve ser YYYY-MM" }, { status: 400 })
  }
  try {
    const result = await enviarFechamentoMensal(mesParam ?? mesAnteriorBrasilia(), searchParams.get("aviso") ?? undefined)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[fechamento-nf]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
