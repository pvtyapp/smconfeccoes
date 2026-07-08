// Ordem padrão de vestuário pra ordenar tamanho — usado no PDV, no chatbot, em
// relatórios de custo e produção. Antes existiam 4 cópias divergentes dessa lista
// pelo sistema; tamanhos infantis numéricos (4,6,8...) só existiam numa delas —
// nos outros 3 lugares, um tamanho não reconhecido caía num modo de emergência que
// ordena como texto ("10" antes de "4", porque "1" é menor que "4" letra por letra).
export const SIZE_ORDER = [
  "pp", "p", "m", "g", "gg", "ggg", "xgg", "gggg",
  "único", "unico", "u",
  "xs", "s", "l", "xl", "xxl", "xxxl",
  "2", "4", "6", "8", "10", "12", "14", "16",
]

function sizeRank(size: string): number {
  return SIZE_ORDER.indexOf(size.toLowerCase().trim())
}

// Comparator — usar direto num Array.prototype.sort
export function sizeCompare(a: string, b: string): number {
  const ai = sizeRank(a)
  const bi = sizeRank(b)
  if (ai === -1 && bi === -1) return a.localeCompare(b)
  if (ai === -1) return 1
  if (bi === -1) return -1
  return ai - bi
}

// Retorna uma cópia do array já ordenada
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort(sizeCompare)
}
