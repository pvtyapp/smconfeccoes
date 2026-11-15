// Cortes terceirizados (PIV 14/11): contas do corte, sem banco — usado pela tela do
// cortador, pela tela de aprovação e pelo servidor (aviso no grupo SM Administrativo).

export type CorCorte = {
  cor: string
  grade: Record<string, number>   // tamanho → peças
  bobinas: number[]               // kg de cada bobina usada
  sobra: number                   // kg do pedaço que sobrou (volta pro estoque de malha)
}

export type MalhaCorte = {
  precoKg: number | null
  largura: number | null          // m (largura aberta)
  gramatura: number | null        // g/m²
  porCor: boolean
  precoCor: Record<string, number | null>
  maoCorte: number | null         // R$ por peça, se o cortador cobra por peça
}

export type LinhaCusto = {
  cor: string
  pecas: number
  kg: number
  kgPeca: number
  precoKg: number | null
  tecido: number | null
  metros: number | null
  porPeca: number | null
}

export const r2 = (v: number) => Math.round(v * 100) / 100

export const pecasDaCor = (c: CorCorte) => Object.values(c.grade).reduce((s, v) => s + (Number(v) || 0), 0)
export const kgDaCor = (c: CorCorte) => Math.max(0, c.bobinas.reduce((s, v) => s + v, 0) - (c.sobra || 0))

// "13,8" ou "13.8" → 13.8; vazio/inválido → NaN
export function lerDecimal(s: string | number | null | undefined): number {
  if (typeof s === "number") return s
  const v = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(v) ? v : NaN
}

// Custo do tecido por peça = kg usado × preço do kg ÷ peças (cor por cor) + corte por peça.
// Largura e gramatura só dão os metros (kg × 1000 ÷ (g/m² × largura)) pra comparar consumo.
export function calcularCorte(cores: CorCorte[], m: MalhaCorte) {
  const linhas: LinhaCusto[] = cores.map(c => {
    const pecas = pecasDaCor(c)
    const kg = kgDaCor(c)
    const precoKg = m.porCor && (m.precoCor[c.cor] ?? 0) > 0 ? (m.precoCor[c.cor] as number) : m.precoKg
    const tecido = precoKg && precoKg > 0 ? kg * precoKg : null
    const metros = m.largura && m.gramatura && m.largura > 0 && m.gramatura > 0 ? (kg * 1000) / (m.gramatura * m.largura) : null
    const porPeca = tecido != null && pecas > 0 ? tecido / pecas + (m.maoCorte || 0) : null
    return { cor: c.cor, pecas, kg, kgPeca: pecas ? kg / pecas : 0, precoKg: precoKg ?? null, tecido, metros, porPeca }
  })
  const pecas = linhas.reduce((s, l) => s + l.pecas, 0)
  const kg = linhas.reduce((s, l) => s + l.kg, 0)
  const tecido = linhas.every(l => l.tecido != null) ? linhas.reduce((s, l) => s + (l.tecido as number), 0) : null
  const metros = linhas.every(l => l.metros != null) ? linhas.reduce((s, l) => s + (l.metros as number), 0) : null
  const porPeca = tecido != null && pecas > 0 ? tecido / pecas + (m.maoCorte || 0) : null
  const total = porPeca != null ? porPeca * pecas : null
  // cor que gastou mais de 15% de malha por peça acima da média do corte
  const media = pecas ? kg / pecas : 0
  const gastoAlto = linhas.filter(l => l.pecas > 0 && media > 0 && l.kgPeca > media * 1.15).map(l => l.cor)
  return { linhas, pecas, kg, tecido, metros, porPeca, total, gastoAlto }
}

export const codigoCorte = (id: number) => `C-${String(id).padStart(4, "0")}`
