import { cronFechamentoProducao } from "@/lib/reports/producaoCron"

// Vercel Cron 0 12 * * 6 = sábado 9h Brasília: seg a sex da semana (PIV 14/11)
export const GET = (req: Request) => cronFechamentoProducao(req, "semanal")
