export function fmtR(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
