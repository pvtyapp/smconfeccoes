// Datas de cada fechamento da produção e o envio pro grupo SM Administrativo (PIV 14/11).
import { todayBR } from "@/lib/tz"
import { mensagemDiaria, mensagemPeriodo, somaDias } from "@/lib/reports/producao"
import { sendAdministrativo } from "@/lib/whatsapp/administrativoGroup"

export type TipoFechamento = "diario" | "semanal" | "mensal"

// hoje = dia em que o cron roda (BRT). Semanal roda no sábado → seg a sex dessa semana.
// Mensal roda no dia 1º → mês anterior.
export async function montarFechamentoProducao(tipo: TipoFechamento, hoje = todayBR()): Promise<string> {
  if (tipo === "diario") return mensagemDiaria(hoje)
  if (tipo === "semanal") {
    const dow = new Date(hoje + "T12:00:00").getDay()
    const sexta = somaDias(hoje, -((dow + 2) % 7))          // última sexta (no sábado = ontem)
    const seg = somaDias(sexta, -4)
    return mensagemPeriodo("semanal", seg, sexta, somaDias(seg, -7), somaDias(sexta, -7))
  }
  const ini = somaDias(hoje.slice(0, 8) + "01", -1).slice(0, 8) + "01"     // 1º do mês anterior
  const fim = somaDias(hoje.slice(0, 8) + "01", -1)
  const antIni = somaDias(ini, -1).slice(0, 8) + "01", antFim = somaDias(ini, -1)
  return mensagemPeriodo("mensal", ini, fim, antIni, antFim)
}

// Só manda se a mensagem montou inteira; erro fica no log e o grupo não recebe nada quebrado.
export async function enviarFechamentoProducao(tipo: TipoFechamento): Promise<{ ok: boolean; erro?: string }> {
  let texto: string
  try { texto = await montarFechamentoProducao(tipo) } catch (e) {
    console.error(`[producao] fechamento ${tipo} não montou:`, e)
    return { ok: false, erro: "não montou" }
  }
  await sendAdministrativo(texto)
  return { ok: true }
}
