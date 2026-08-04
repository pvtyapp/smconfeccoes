// Cor é texto livre no cadastro — não dá pra ter hex exato de cada uma.
// Casa por palavra-chave (sem acento) pra achar uma cor aproximada só pra
// bolinha do bloco (PDV, Gerenciador de Pedidos); sem match cai num cinza neutro.
const COLOR_KEYWORDS: [string, string][] = [
  ["preto", "#171717"], ["branco", "#F8FAFC"], ["cinza", "#9CA3AF"], ["grafite", "#4B5563"],
  ["chumbo", "#374151"], ["azul marinho", "#1E3A8A"], ["azul royal", "#2563EB"], ["azul", "#3B82F6"],
  ["vermelh", "#DC2626"], ["bordo", "#7F1D1D"], ["vinho", "#7F1D1D"], ["rosa bebe", "#FBCFE8"],
  ["rosa", "#EC4899"], ["verde militar", "#4D5D3A"], ["verde", "#16A34A"], ["amarelo", "#FACC15"],
  ["laranja", "#F97316"], ["roxo", "#7C3AED"], ["roxa", "#7C3AED"], ["lilas", "#C4B5FD"],
  ["marrom", "#78350F"], ["bege", "#D9C5A0"], ["caramelo", "#B45309"], ["dourado", "#CA8A04"],
  ["prata", "#D1D5DB"], ["mescla", "#9CA3AF"],
]

export function colorSwatch(name: string): string {
  const n = (name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  for (const [kw, hex] of COLOR_KEYWORDS) if (n.includes(kw)) return hex
  return "#CBD5E1"
}
