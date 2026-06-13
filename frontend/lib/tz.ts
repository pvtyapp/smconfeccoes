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

/** ISO timestamp → "dd/mm/yyyy" in São Paulo timezone */
export function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  })
}
