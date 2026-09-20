// Mapa cor→hex pra desenhar a bolinha nas pills de variação. Cobre os nomes de
// cor mais comuns em PT-BR usados no cadastro de produto — o texto do nome
// sempre acompanha a bolinha (nunca só a cor sozinha), pra não depender de
// reconhecimento visual perfeito num nicho de cliente que não é técnico.
const COLOR_MAP: Record<string, string> = {
  branco: "#F5F5F5", "off white": "#F2EEE4", offwhite: "#F2EEE4", cru: "#E8DFC8",
  preto: "#111111", chumbo: "#3A3A3A", grafite: "#4A4A4A", cinza: "#9CA3AF",
  "cinza claro": "#D1D5DB", "cinza escuro": "#4B5563", mescla: "#B4B4B4",
  azul: "#2563EB", "azul marinho": "#1E3A8A", marinho: "#1E3A8A", "azul claro": "#60A5FA",
  "azul royal": "#1D4ED8", turquesa: "#14B8A6", ciano: "#06B6D4",
  vermelho: "#DC2626", vinho: "#7F1D1D", bordo: "#7F1D1D", bordô: "#7F1D1D",
  rosa: "#EC4899", "rosa claro": "#F9A8D4", pink: "#DB2777", salmao: "#FB7185", salmão: "#FB7185",
  verde: "#16A34A", "verde militar": "#4D7C4D", militar: "#4D7C4D", "verde musgo": "#556B2F",
  "verde claro": "#86EFAC", "verde escuro": "#166534", oliva: "#6B7A3A",
  amarelo: "#EAB308", mostarda: "#CA8A04", dourado: "#B8860B", ouro: "#B8860B",
  laranja: "#EA580C", terracota: "#C2703D",
  roxo: "#7C3AED", lilas: "#C4B5FD", lilás: "#C4B5FD", lavanda: "#B4A7D6",
  marrom: "#78350F", caramelo: "#B5651D", chocolate: "#5C3317", nude: "#D9BBA0",
  bege: "#D9C7A3", areia: "#D6C7A1", caqui: "#BDB76B",
  prata: "#C0C0C0", prateado: "#C0C0C0",
}

export function colorToHex(name: string | null | undefined): string {
  if (!name) return "#D1D5DB"
  const key = name.trim().toLowerCase()
  if (COLOR_MAP[key]) return COLOR_MAP[key]
  const partial = Object.keys(COLOR_MAP).find((k) => key.includes(k) || k.includes(key))
  if (partial) return COLOR_MAP[partial]
  // Sem match — gera uma cor estável a partir do texto, pra pelo menos diferenciar
  // visualmente entre cores desconhecidas distintas, mas nunca duas iguais renderem diferente.
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 55%)`
}

// Cores muito claras precisam de borda visível pra bolinha não sumir no fundo branco.
export function needsBorder(hex: string): boolean {
  const light = ["#F5F5F5", "#F2EEE4", "#E8DFC8", "#D1D5DB", "#F9A8D4", "#86EFAC", "#C4B5FD", "#D9C7A3", "#D6C7A1", "#C0C0C0"]
  return light.includes(hex)
}
