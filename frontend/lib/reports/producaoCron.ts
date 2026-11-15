import { NextResponse } from "next/server"
import { enviarFechamentoProducao, type TipoFechamento } from "@/lib/reports/producaoEnvio"
import { isWeekendBR } from "@/lib/tz"

// Corpo comum das 3 rotas de cron do fechamento da produção (PIV 14/11).
export async function cronFechamentoProducao(req: Request, tipo: TipoFechamento) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (tipo === "diario" && isWeekendBR()) return NextResponse.json({ ok: true, pulado: "fim de semana" })
  const r = await enviarFechamentoProducao(tipo)
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}
