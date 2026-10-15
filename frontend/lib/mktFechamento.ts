// Fechamento diário do marketplace (Shopee/TikTok) — migration 020.
// Lançado pelo agente do outro PC (POST /api/marketplace/fechamento, de dentro do navegador
// logado) ou corrigido à mão na aba Lançamentos. Este arquivo não fala com o banco: serve pra
// tela e pras rotas. A parte de banco fica em lib/mktFechamentoDb.ts.

export const LOJAS_MKT = ["SHP_MARI", "SHP_SAMU", "TKTK_SAMU"] as const
export type LojaMkt = typeof LOJAS_MKT[number]

export const PLATAFORMA_MKT: Record<string, { nome: string; cor: string }> = {
  shopee: { nome: "Shopee", cor: "#EE4D2D" },
  tiktok: { nome: "TikTok", cor: "#111827" },
}
export const plataformaDaLoja = (loja: string) => (loja.startsWith("TKTK") ? "tiktok" : "shopee")

// Primeiro dia do histórico (PIV 15/10/2026): antes disso não cobra lançamento.
export const MKT_INICIO = "2026-10-01"

export type FechamentoMkt = {
  id: number
  dia: string                // YYYY-MM-DD
  loja: LojaMkt
  pedidos: number
  pecas: number
  vendas: number
  taxas: number
  cupom: number
  frete: number
  ads: number
  custo: number | null
  lucro: number
  itensSemCusto: number
  qtdItens: number           // linhas de item gravadas pro dia + loja
  somaItens: number          // soma do valor dos itens (conferência com "vendas")
  pedidosUpseller: number | null
  repasse: number | null
  observacao: string | null
  origem: "robo" | "manual"
  atualizadoPor: string | null
  updatedAt: string
}

export type RegraCusto = {
  id: number
  prefixo: string
  nome: string
  produtos: string[]
  extra: number
  custoUnitario: number      // soma do material_cost dos produtos + extra
  produtosSemCusto: number   // produtos da regra sem material_cost cadastrado
}

// Número vindo da API ou da tela: aceita 12.5, "12,50", "R$ 1.234,56". Vazio → null.
export function paraNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN
  let s = String(v).replace(/R\$/i, "").replace(/\s/g, "")
  if (s === "") return null
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const r2 = (n: number) => Math.round(n * 100) / 100
export const arred = r2

export function lucroDe(f: { vendas: number; taxas: number; cupom: number; frete: number; ads: number; custo: number | null }) {
  return r2(f.vendas - f.taxas - f.cupom - f.frete - f.ads - (f.custo ?? 0))
}

// Avisos de conferência de um fechamento (tela e resposta da API).
export function avisosDe(f: FechamentoMkt): string[] {
  const a: string[] = []
  if (f.pedidosUpseller !== null && f.pedidosUpseller !== f.pedidos)
    a.push(`Pedidos não batem: ${f.pedidos} no relatório, ${f.pedidosUpseller} no Upseller`)
  if (f.repasse !== null) {
    const esperado = r2(f.vendas - f.taxas - f.cupom - f.frete)
    if (Math.abs(esperado - f.repasse) > 1)
      a.push(`Repasse não bate: a plataforma mostra ${fmtBRL(f.repasse)}, a conta dá ${fmtBRL(esperado)}`)
  }
  if (f.qtdItens > 0 && Math.abs(f.somaItens - f.vendas) > 1)
    a.push(`Soma dos itens (${fmtBRL(f.somaItens)}) diferente das vendas (${fmtBRL(f.vendas)})`)
  if (f.itensSemCusto > 0) a.push(`${f.itensSemCusto} item(ns) sem regra de custo`)
  if (f.qtdItens === 0 && f.pedidos > 0) a.push("Sem itens: custo e lucro ficam incompletos")
  return a
}

// Regra que vale pro SKU: o maior prefixo que casar (sem diferenciar maiúscula).
export function regraDoSku(regras: RegraCusto[], sku: string | null | undefined): RegraCusto | null {
  if (!sku) return null
  const s = sku.trim().toLowerCase()
  let melhor: RegraCusto | null = null
  for (const r of regras) {
    const p = r.prefixo.trim().toLowerCase()
    if (p && s.startsWith(p) && (!melhor || p.length > melhor.prefixo.trim().length)) melhor = r
  }
  return melhor
}

export const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

// Lista de dias (YYYY-MM-DD) de `de` até `ate`, inclusive.
export function diasEntre(de: string, ate: string): string[] {
  const out: string[] = []
  const d = new Date(`${de}T12:00:00Z`)
  const fim = new Date(`${ate}T12:00:00Z`)
  while (d <= fim && out.length < 800) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Regra de custo vinda da tela: { prefixo, nome, produtos: uuid[], extra } (tudo opcional no PUT)
export function validarRegra(b: Record<string, unknown>, parcial: boolean): { valores: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {}
  if (!parcial || "prefixo" in b) {
    const p = String(b.prefixo ?? "").trim()
    if (!p) return { error: "prefixo é obrigatório" }
    v.prefixo = p
  }
  if (!parcial || "nome" in b) {
    const n = String(b.nome ?? "").trim()
    if (!n) return { error: "nome é obrigatório" }
    v.nome = n
  }
  if (!parcial || "produtos" in b) {
    const ps = b.produtos ?? []
    if (!Array.isArray(ps) || ps.some(x => typeof x !== "string" || !/^[0-9a-f-]{36}$/i.test(x))) return { error: "produtos deve ser uma lista de ids" }
    v.produtos = ps
  }
  if (!parcial || "extra" in b) {
    const e = paraNumero(b.extra ?? 0)
    if (e === null || Number.isNaN(e) || e < 0) return { error: "extra deve ser um valor não negativo" }
    v.extra = e
  }
  return { valores: v }
}
