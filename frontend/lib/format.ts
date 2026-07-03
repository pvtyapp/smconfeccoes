export function fmtR(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtQtd(v: number | null | undefined, unidade: string): string {
  if (v == null) return "—"
  return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unidade}`
}
