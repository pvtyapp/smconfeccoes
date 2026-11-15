import { cronFechamentoProducao } from "@/lib/reports/producaoCron"

// Vercel Cron 0 12 1 * * = dia 1º 9h Brasília: mês anterior (PIV 14/11)
export const GET = (req: Request) => cronFechamentoProducao(req, "mensal")
