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
// sobra: campo saiu da tela (PIV 14/11: a sobra já está no custo da bobina); cortes antigos podem ter
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

// ── custo por tamanho (PIV 14/11) ───────────────────────────
// Ninguém pesa peça: a proporção sai do histórico. Cada cor de cada corte aprovado diz
// "kg = soma (peças do tamanho × kg da peça do tamanho)". Pra ficar firme com poucos cortes e
// bobina variando, acha só 2 números: kg da peça menor (a) e quanto cada tamanho acima gasta a
// mais (b): kg = a × peças + b × soma(peças × posição do tamanho), mínimos quadrados.
// A sobra da bobina já está no custo (PIV), então kg = bobinas inteiras.
export type Proporcao = { w: Record<string, number>; ok: boolean; n: number }
export const PROPORCAO_MIN_CORTES = 3
export const PASSO_TAMANHO = 0.09   // ponto de partida: cada tamanho gasta ~9% a mais que o anterior

export function aprenderProporcao(rows: { grade: Record<string, number>; kg: number }[], sizes: string[]): Proporcao {
  const pecasTot = rows.reduce((s, r) => s + Object.values(r.grade).reduce((a, b) => a + (b || 0), 0), 0)
  const base = pecasTot ? rows.reduce((s, r) => s + r.kg, 0) / pecasTot : 0
  const igual: Proporcao = { w: Object.fromEntries(sizes.map(t => [t, base])), ok: false, n: rows.length }
  if (rows.length < PROPORCAO_MIN_CORTES || !sizes.length) return igual
  let s11 = 0, s12 = 0, s22 = 0, y1 = 0, y2 = 0
  for (const r of rows) {
    const x1 = sizes.reduce((s, t) => s + (r.grade[t] || 0), 0)
    const x2 = sizes.reduce((s, t, i) => s + (r.grade[t] || 0) * i, 0)
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; y1 += x1 * r.kg; y2 += x2 * r.kg
  }
  if (!(s22 > 0)) return igual
  // Bobina varia de um corte pro outro e esconde a diferença entre tamanhos quando as grades são
  // parecidas. Então a conta parte da regra de mercado (cada tamanho ~9% a mais de malha que o
  // anterior, b = k·a) com o peso de ~5 cortes e os cortes da casa vão corrigindo: com poucos
  // cortes fica perto dos 9%, com muitos manda o que a SM corta de verdade.
  // peso do ponto de partida = ~5 cortes, medido só na parte que separa tamanho (grade puxada pro G/GG ou pro P)
  const k = PASSO_TAMANHO, lam = 5 * Math.max(1e-9, s22 - (s12 * s12) / s11) / rows.length
  const A11 = s11 + lam * k * k, A12 = s12 - lam * k, A22 = s22 + lam
  const det = A11 * A22 - A12 * A12
  if (Math.abs(det) < 1e-9) return igual
  const a = (y1 * A22 - y2 * A12) / det
  const b = Math.max(0, (A11 * y2 - A12 * y1) / det)
  if (!(a > 0)) return igual
  return { w: Object.fromEntries(sizes.map((t, i) => [t, a + b * i])), ok: true, n: rows.length }
}

// kg que essa grade deveria gastar pela proporção
export const kgEsperado = (grade: Record<string, number>, w: Record<string, number>) =>
  Object.entries(grade).reduce((s, [t, q]) => s + (q || 0) * (w[t] || 0), 0)

// custo por peça de cada tamanho: divide o valor da malha da cor na proporção (a soma fecha com a malha)
export function porTamanho(grade: Record<string, number>, malha: number, w: Record<string, number>): Record<string, number> {
  const S = kgEsperado(grade, w)
  return Object.fromEntries(Object.keys(grade).filter(t => grade[t] > 0).map(t => [t, S ? (malha * (w[t] || 0)) / S : 0]))
}

// gastou mais de 8% acima do esperado pra grade → alerta de desperdício
export const LIMITE_DESPERDICIO = 0.08
export function desperdicio(cores: CorCorte[], p: Proporcao | null | undefined) {
  if (!p?.ok) return null
  const esperado = cores.reduce((s, c) => s + kgEsperado(c.grade, p.w), 0)
  const real = cores.reduce((s, c) => s + kgDaCor(c), 0)
  if (!esperado) return null
  const excesso = real - esperado
  return { esperado, real, excesso, pct: excesso / esperado, alto: excesso / esperado > LIMITE_DESPERDICIO }
}
