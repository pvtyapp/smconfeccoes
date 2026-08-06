export const TZ = "America/Sao_Paulo"

/** Today as YYYY-MM-DD in São Paulo timezone */
export function todayBR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ })
}

/** N days ago as YYYY-MM-DD in São Paulo timezone */
export function subDaysBR(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ })
}

/** Arbitrary Date object → YYYY-MM-DD in São Paulo timezone */
export function dateBR(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ })
}

/** True if today (São Paulo timezone) is Saturday or Sunday */
export function isWeekendBR(d: Date = new Date()): boolean {
  const day = d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" })
  return day === "Sat" || day === "Sun"
}

/** ISO timestamp (instante real, ex: created_at) → "dd/mm/yyyy" em horário de SP */
export function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  })
}

/**
 * Coluna SQL DATE pura (data.dtf_pedidos, due_date, cost_date — sem hora, sem
 * instante real) → "dd/mm/yyyy", SEM conversão de fuso. O pg devolve DATE como
 * meia-noite UTC; rodar isso por fmtDateBR (que converte pra America/Sao_Paulo)
 * subtrai 3h e joga pro dia anterior. Usar sempre que o valor vier de uma
 * coluna DATE, nunca de TIMESTAMPTZ.
 */
export function fmtDateOnlyBR(d: string | null | undefined): string {
  if (!d) return "—"
  const [y, m, day] = d.slice(0, 10).split("-")
  if (!y || !m || !day) return "—"
  return `${day}/${m}/${y}`
}
