import { NextResponse } from "next/server"
import { montarFechamentoProducao, type TipoFechamento } from "@/lib/reports/producaoEnvio"
import { todayBR } from "@/lib/tz"

// Prévia do fechamento da produção SEM mandar no grupo (pra conferir). Precisa de login.
// /api/producao/previa?tipo=diario|semanal|mensal&hoje=AAAA-MM-DD (hoje = dia em que o cron rodaria)
export async function GET(req: Request) {
  const u = new URL(req.url)
  const tipo = (u.searchParams.get("tipo") ?? "diario") as TipoFechamento
  const hoje = u.searchParams.get("hoje") ?? todayBR()
  if (!["diario", "semanal", "mensal"].includes(tipo) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return NextResponse.json({ error: "parâmetros inválidos" }, { status: 400 })
  try {
    const msgs = await montarFechamentoProducao(tipo, hoje)
    return NextResponse.json({ mensagens: msgs, texto: msgs.join("\n\n━━━━━━ próxima mensagem ━━━━━━\n\n") })
  } catch (e) {
    console.error("[producao/previa]", e)
    return NextResponse.json({ error: "não montou" }, { status: 500 })
  }
}
