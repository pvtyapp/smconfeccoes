import { cronFechamentoProducao } from "@/lib/reports/producaoCron"

// Vercel Cron 30 22 * * 1-5 = 19h30 Brasília, seg a sex (PIV 14/11)
export const GET = (req: Request) => cronFechamentoProducao(req, "diario")
