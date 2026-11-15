// Fechamento da produção (PIV 14/11/2026) — grupo SM Administrativo:
//   diário 19h30 seg–sex · semanal sábado 9h (seg–sex) · mensal dia 1º 9h (mês anterior).
// Produção = só o que ENTROU NO ESTOQUE como "producao" (corte não é produção; só entra
// quando a peça fica pronta). Custo de costura = soma de "Custo de Costura" do Custo
// Operacional (mensal) ÷ dias úteis do mês. Média SEMPRE ponderada: custo ÷ peças.
// Peso de costura por produto: calculado das entradas por semana (nada do campo antigo).
// Peça pronta = malha do histórico de cortes (por tamanho) + costura.
import { pool } from "@/lib/db"
import { historicoCortes, proporcoes } from "@/lib/cortes"
import { calcularCorte, porTamanho } from "@/lib/cortesCalc"
import { saldosVariantes, abaixoDoMinimo, linhasProduzir, aProduzir } from "@/lib/estoqueMinimo"

export type Entrada = { data: string; produto: string; cor: string; tam: string; tamIdx: number; qtd: number }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR")
const pct = (v: number) => `${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
const dBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]
const diaSem = (iso: string) => new Date(iso + "T12:00:00").getDay()
export const somaDias = (iso: string, d: number) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }
// Feriados nacionais (fixos + Carnaval/Sexta Santa/Corpus Christi de 2026 e 2027). Feriado de
// Franca não está aqui: se a SM parar num feriado municipal, entra como dia útil sem peça.
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]
const FERIADOS_MOVEIS = ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04", "2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27"]
const util = (iso: string) => { const d = diaSem(iso); return d >= 1 && d <= 5 && !FERIADOS_FIXOS.includes(iso.slice(5)) && !FERIADOS_MOVEIS.includes(iso) }

export async function entradasProducao(de: string, ate: string): Promise<Entrada[]> {
  const { rows } = await pool.query(`
    SELECT TO_CHAR(DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS data,
           p.name AS produto, pv.color AS cor, pv.size AS tam,
           COALESCE(array_position(p.size_list, pv.size), 99) AS "tamIdx", SUM(sm.quantity)::int AS qtd
      FROM stock_movements sm
      JOIN product_variants pv ON pv.id = sm.variant_id
      JOIN products p ON p.id = pv.product_id
     WHERE sm.type = 'in' AND sm.reason = 'producao'
       AND DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date
     GROUP BY 1, 2, 3, 4, 5
  `, [de, ate])
  return rows.map(r => ({ ...r, qtd: Number(r.qtd), tamIdx: Number(r.tamIdx) }))
}

// ── custo de costura ────────────────────────────────────────
export async function costuraMensal(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(monthly_value), 0)::float AS v FROM operational_costs WHERE active = true AND category = 'Custo de Costura'`)
  return Number(rows[0]?.v ?? 0)
}
export function diasUteisDoMes(iso: string): number {
  const [y, m] = iso.split("-").map(Number)
  let n = 0
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) if (util(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)) n++
  return n || 1
}
// custo de costura de cada dia útil do período (fim de semana = 0)
export function custoCosturaPeriodo(mensal: number, de: string, ate: string): number {
  let s = 0
  for (let d = de; d <= ate; d = somaDias(d, 1)) if (util(d)) s += mensal / diasUteisDoMes(d)
  return s
}

// ── peso de costura por produto, calculado das entradas por semana ──
// Toda semana a costura custa ~o mesmo; semana com mais produto pesado entra menos peça.
// Mínimos quadrados: soma(peso × peças do produto na semana) ≈ custo da semana em "peças-padrão",
// puxando cada peso pra 1 com a força de ~4 semanas daquele produto (com pouco dado fica perto de 1).
export type Pesos = { peso: Record<string, number>; semanas: number; ok: boolean }
export async function pesosCostura(ate: string, mensal: number): Promise<Pesos> {
  // semanas completas (seg–sex) das últimas 26, terminando antes de `ate`
  let seg = somaDias(ate, -((diaSem(ate) + 6) % 7))       // segunda da semana de `ate`
  if (somaDias(seg, 4) > ate) seg = somaDias(seg, -7)
  const ini = somaDias(seg, -7 * 25)
  const es = await entradasProducao(ini, somaDias(seg, 4))
  const semanas: { q: Record<string, number>; custo: number }[] = []
  for (let s = ini; s <= seg; s = somaDias(s, 7)) {
    const q: Record<string, number> = {}
    for (const e of es) if (e.data >= s && e.data <= somaDias(s, 4)) q[e.produto] = (q[e.produto] ?? 0) + e.qtd
    if (Object.values(q).reduce((a, b) => a + b, 0) > 0) semanas.push({ q, custo: custoCosturaPeriodo(mensal, s, somaDias(s, 4)) })
  }
  const prods = [...new Set(es.map(e => e.produto))]
  const um = Object.fromEntries(prods.map(p => [p, 1]))
  if (semanas.length < 4 || prods.length < 2) return { peso: um, semanas: semanas.length, ok: false }
  const totQ = semanas.reduce((s, w) => s + Object.values(w.q).reduce((a, b) => a + b, 0), 0)
  const cpp = semanas.reduce((s, w) => s + w.custo, 0) / totQ
  const n = prods.length
  const A = prods.map(() => Array(n).fill(0)), b = Array(n).fill(0)
  for (const w of semanas) {
    const x = prods.map(p => w.q[p] ?? 0), y = w.custo / cpp
    for (let i = 0; i < n; i++) { b[i] += x[i] * y; for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j] }
  }
  prods.forEach((p, i) => { const lam = 4 * semanas.reduce((s, w) => s + (w.q[p] ?? 0) ** 2, 0) / semanas.length || 1; A[i][i] += lam; b[i] += lam })
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r
    if (Math.abs(M[pv][c]) < 1e-12) return { peso: um, semanas: semanas.length, ok: false };
    [M[c], M[pv]] = [M[pv], M[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  const peso = Object.fromEntries(prods.map((p, i) => [p, Math.min(6, Math.max(0.25, M[i][n] / M[i][i]))]))
  return { peso, semanas: semanas.length, ok: true }
}

// custo de costura por peça de cada produto num período: divide o custo pelos pesos
export function rateioCostura(qtdPorProduto: Record<string, number>, custo: number, pesos: Pesos): Record<string, number> {
  const S = Object.entries(qtdPorProduto).reduce((s, [p, q]) => s + q * (pesos.peso[p] ?? 1), 0)
  return Object.fromEntries(Object.keys(qtdPorProduto).map(p => [p, S ? (custo * (pesos.peso[p] ?? 1)) / S : 0]))
}

// ── malha por tamanho (dos cortes aprovados dos últimos 90 dias) ──
export async function malhaPorTamanho(ate: string): Promise<Record<string, Record<string, number>>> {
  const [cortes, props] = await Promise.all([historicoCortes(somaDias(ate, -90), ate), proporcoes(ate)])
  const acc: Record<string, Record<string, { v: number; q: number }>> = {}
  for (const k of cortes) {
    const ct = calcularCorte(k.cores, k.malha)
    const w = props[k.productName]?.w
    ct.linhas.forEach((l, i) => {
      const g = k.cores[i].grade
      const pt = w ? porTamanho(g, l.tecido ?? 0, w) : Object.fromEntries(Object.keys(g).map(t => [t, l.pecas ? (l.tecido ?? 0) / l.pecas : 0]))
      for (const [t, v] of Object.entries(pt)) { const x = ((acc[k.productName] ??= {})[t] ??= { v: 0, q: 0 }); x.v += v * g[t]; x.q += g[t] }
    })
  }
  return Object.fromEntries(Object.entries(acc).map(([p, ts]) => [p, Object.fromEntries(Object.entries(ts).map(([t, x]) => [t, x.q ? x.v / x.q : 0]))]))
}

// ── mensagens ───────────────────────────────────────────────
function agrupa(es: Entrada[]) {
  const porProd = new Map<string, { qtd: number; tams: Map<string, { idx: number; q: number }> }>()
  for (const e of es) {
    const p = porProd.get(e.produto) ?? { qtd: 0, tams: new Map() }
    p.qtd += e.qtd
    const t = p.tams.get(e.tam) ?? { idx: e.tamIdx, q: 0 }; t.q += e.qtd; p.tams.set(e.tam, t)
    porProd.set(e.produto, p)
  }
  return [...porProd.entries()].sort((a, b) => b[1].qtd - a[1].qtd)
}

function linhasPecaPronta(produtos: string[], tamsDe: (p: string) => string[], malha: Record<string, Record<string, number>>, costura: Record<string, number>): string[] {
  return produtos.filter(p => malha[p]).map(p =>
    `• ${p}: ${tamsDe(p).filter(t => malha[p][t] != null).map(t => `${t} ${brl(malha[p][t] + (costura[p] ?? 0))}`).join(" · ")}`)
}

const notaPesos = (ps: Pesos) => {
  if (!ps.ok) return `_Peso de costura: todos iguais por enquanto (precisa de 4 semanas com produtos diferentes; tem ${ps.semanas})._`
  const ref = Object.entries(ps.peso).sort((a, b) => a[1] - b[1])[0]
  return `_Peso de costura calculado em ${ps.semanas} semanas: ${Object.entries(ps.peso).sort((a, b) => b[1] - a[1]).map(([p, w]) => `${p} ${(w / ref[1]).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`).join(" · ")} (1x = ${ref[0]})._`
}

export async function mensagemDiaria(data: string): Promise<string> {
  const mensal = await costuraMensal()
  const iniMes = data.slice(0, 8) + "01"
  const [hoje, mes, pesos, malha, vs] = await Promise.all([
    entradasProducao(data, data), entradasProducao(iniMes, data), pesosCostura(data, mensal), malhaPorTamanho(data), saldosVariantes(),
  ])
  const custoDia = util(data) ? mensal / diasUteisDoMes(data) : 0
  const custoMes = custoCosturaPeriodo(mensal, iniMes, data)
  const pecas = hoje.reduce((s, e) => s + e.qtd, 0), pecasMes = mes.reduce((s, e) => s + e.qtd, 0)
  const g = agrupa(hoje)
  const qtdMes: Record<string, number> = {}; for (const e of mes) qtdMes[e.produto] = (qtdMes[e.produto] ?? 0) + e.qtd
  const costuraMesProd = rateioCostura(qtdMes, custoMes, pesos)
  const tamsDe = (p: string) => [...(g.find(x => x[0] === p)?.[1].tams.entries() ?? [])].sort((a, b) => a[1].idx - b[1].idx).map(x => x[0])

  const out: string[] = [`🧵 *Fechamento da produção · ${DIAS[diaSem(data)]} ${dBR(data)}*`, ""]
  if (!pecas) out.push("Hoje não entrou peça no estoque.")
  else {
    out.push(`Entraram *${n0(pecas)} peças* no estoque`)
    for (const [p, x] of g) out.push(`• ${p}: *${n0(x.qtd)}* (${[...x.tams.entries()].sort((a, b) => a[1].idx - b[1].idx).map(([t, v]) => `${t} ${v.q}`).join(" · ")})`)
  }
  out.push("", `💰 *Costura*: ${brl(custoDia)} hoje${pecas ? ` ÷ ${n0(pecas)} peças = *${brl(custoDia / pecas)} por peça*` : ""}`)
  if (pecasMes) out.push(`Média do mês até hoje: *${brl(custoMes / pecasMes)} por peça* (${n0(pecasMes)} peças)`)
  if (pecas && g.length > 1) {
    const qHoje = Object.fromEntries(g.map(([p, x]) => [p, x.qtd]))
    const r = rateioCostura(qHoje, custoDia, pesos)
    out.push(`Por produto hoje: ${g.map(([p]) => `${p} ${brl(r[p])}`).join(" · ")}`)
  }
  const pronta = linhasPecaPronta(g.map(x => x[0]), tamsDe, malha, costuraMesProd)
  if (pronta.length) out.push("", "👕 *Peça pronta* (malha dos cortes + costura média do mês)", ...pronta)
  const abaixo = vs.filter(abaixoDoMinimo)
  if (abaixo.length) out.push("", `🔻 *Abaixo do mínimo* (${abaixo.length}) · tamanho *disponível*/mínimo`, ...linhasProduzir(abaixo, 15), `Pra produzir até o alvo: *${n0(abaixo.reduce((s, v) => s + aProduzir(v), 0))} peças*`)
  else if (vs.some(v => v.minStock > 0)) out.push("", "✅ Nada abaixo do mínimo.")
  out.push("", notaPesos(pesos))
  return out.join("\n")
}

// semanal e mensal: mesmo formato, com comparação com o período anterior
export async function mensagemPeriodo(tipo: "semanal" | "mensal", de: string, ate: string, antDe: string, antAte: string): Promise<string> {
  const mensal = await costuraMensal()
  const [es, ant, pesos, malha] = await Promise.all([entradasProducao(de, ate), entradasProducao(antDe, antAte), pesosCostura(ate, mensal), malhaPorTamanho(ate)])
  const custo = custoCosturaPeriodo(mensal, de, ate), custoAnt = custoCosturaPeriodo(mensal, antDe, antAte)
  const pecas = es.reduce((s, e) => s + e.qtd, 0), pecasAnt = ant.reduce((s, e) => s + e.qtd, 0)
  const g = agrupa(es)
  const qtd = Object.fromEntries(g.map(([p, x]) => [p, x.qtd]))
  const qtdAnt: Record<string, number> = {}; for (const e of ant) qtdAnt[e.produto] = (qtdAnt[e.produto] ?? 0) + e.qtd
  const rat = rateioCostura(qtd, custo, pesos), ratAnt = rateioCostura(qtdAnt, custoAnt, pesos)
  const titulo = tipo === "semanal" ? `📆 *Produção da semana · ${dBR(de)} a ${dBR(ate)}*` : `🗓️ *Produção do mês · ${new Date(de + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}*`
  const nomeAnt = tipo === "semanal" ? "semana anterior" : "mês anterior"
  const out: string[] = [titulo, ""]
  if (!pecas) { out.push("Não entrou peça no estoque nesse período."); return out.join("\n") }
  const cpp = custo / pecas, cppAnt = pecasAnt ? custoAnt / pecasAnt : null
  out.push(`Entraram *${n0(pecas)} peças*${pecasAnt ? ` (${pct(pecas / pecasAnt - 1)} vs ${nomeAnt}: ${n0(pecasAnt)})` : ""}`)
  out.push(`💰 Costura: ${brl(custo)} ÷ ${n0(pecas)} = *${brl(cpp)} por peça*${cppAnt ? ` (${pct(cpp / cppAnt - 1)} vs ${brl(cppAnt)})` : ""}`)
  out.push("", "*Por produto* (peças · costura por peça)")
  for (const [p, x] of g) {
    const a = ratAnt[p]
    out.push(`• ${p}: *${n0(x.qtd)}* · ${brl(rat[p])}${a ? ` (${pct(rat[p] / a - 1)})` : ""}`)
  }
  // dia a dia (semanal) / melhor e pior dia (mensal)
  const porDia: Record<string, number> = {}; for (const e of es) porDia[e.data] = (porDia[e.data] ?? 0) + e.qtd
  const dias = Object.entries(porDia).sort()
  if (tipo === "semanal") out.push("", `Dia a dia: ${dias.map(([d, q]) => `${DIAS[diaSem(d)]} ${n0(q)}`).join(" · ")}`)
  else if (dias.length) {
    const ord = [...dias].sort((a, b) => b[1] - a[1])
    const uteis = diasUteisDoMes(de)
    out.push("", `${dias.length} dias com entrada de ${uteis} úteis · média ${n0(pecas / uteis)} por dia útil`, `Melhor dia: ${dBR(ord[0][0])} (${n0(ord[0][1])}) · mais fraco: ${dBR(ord[ord.length - 1][0])} (${n0(ord[ord.length - 1][1])})`)
  }
  const tamsDe = (p: string) => [...(g.find(x => x[0] === p)?.[1].tams.entries() ?? [])].sort((a, b) => a[1].idx - b[1].idx).map(x => x[0])
  const pronta = linhasPecaPronta(g.map(x => x[0]), tamsDe, malha, rat)
  if (pronta.length) out.push("", `👕 *Peça pronta* (malha dos cortes + costura ${tipo === "semanal" ? "da semana" : "do mês"})`, ...pronta)
  out.push("", notaPesos(pesos))
  return out.join("\n")
}
