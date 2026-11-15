import { NextResponse } from "next/server"
import { checarMinimos } from "@/lib/estoqueMinimo"
import { isWeekendBR } from "@/lib/tz"

// Vercel Cron: a cada 30 min, 8h às 18h (Brasília), segunda a sexta (PIV 14/11).
// Avisa o grupo SM Administrativo só do que acabou de chegar no mínimo, tudo numa mensagem.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (isWeekendBR()) return NextResponse.json({ ok: true, pulado: "fim de semana" })
  try {
    return NextResponse.json({ ok: true, ...(await checarMinimos()) })
  } catch (e) {
    console.error("[estoque/alerta-minimo-cron]", e)
    return NextResponse.json({ error: "falhou" }, { status: 500 })
  }
}
