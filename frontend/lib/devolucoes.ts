// Devoluções do marketplace (Shopee/TikTok) — peças devolvidas pra reaproveitar em pedido novo.
// Tabela `devolucoes` (migration 019). A API fala camelCase; o banco, snake_case.

export const LOJAS_DEVOLUCAO = ["MARI", "SAMUEL"] as const
export const SITUACOES_DEVOLUCAO = ["A caminho", "Disponível", "Reservada", "Usada", "Descartada", "Não volta"] as const
export const ORIGENS_DEVOLUCAO = ["robo", "manual"] as const

export type LojaDevolucao = typeof LOJAS_DEVOLUCAO[number]
export type SituacaoDevolucao = typeof SITUACOES_DEVOLUCAO[number]

export type Devolucao = {
  id: number
  data: string                    // YYYY-MM-DD
  loja: LojaDevolucao
  numeroDevolucao: string | null
  pedido: string | null
  sku: string
  produto: string | null
  cor: string | null
  tamanho: string | null
  quantidade: number
  motivo: string | null
  situacao: SituacaoDevolucao
  pedidoReservado: string | null
  observacao: string | null
  origem: "robo" | "manual"
  createdAt: string
  updatedAt: string
}

export const SELECT_DEVOLUCAO = `
  id, to_char(data, 'YYYY-MM-DD') AS data, loja, numero_devolucao AS "numeroDevolucao", pedido, sku,
  produto, cor, tamanho, quantidade, motivo, situacao, pedido_reservado AS "pedidoReservado",
  observacao, origem, created_at AS "createdAt", updated_at AS "updatedAt"`

// campo da API → coluna do banco (só os editáveis)
export const COLUNAS: Record<string, string> = {
  data: "data", loja: "loja", numeroDevolucao: "numero_devolucao", pedido: "pedido", sku: "sku",
  produto: "produto", cor: "cor", tamanho: "tamanho", quantidade: "quantidade", motivo: "motivo",
  situacao: "situacao", pedidoReservado: "pedido_reservado", observacao: "observacao", origem: "origem",
}

// Normaliza e valida os campos enviados. Só mexe nos que vieram no corpo (serve pro POST e pro PUT).
// Devolve { valores } (já no formato do banco) ou { error }.
export function validarCampos(body: Record<string, unknown>): { valores: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {}
  const texto = (k: string) => {
    const x = body[k]
    if (x === null || x === undefined) return null
    const s = String(x).trim()
    return s === "" ? null : s
  }
  for (const k of Object.keys(body)) {
    if (!(k in COLUNAS)) continue
    if (k === "quantidade") {
      const n = Number(body.quantidade)
      if (!Number.isInteger(n) || n < 1) return { error: "quantidade deve ser um número inteiro maior que zero" }
      v.quantidade = n
    } else if (k === "data") {
      const s = texto("data")
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: "data deve estar no formato AAAA-MM-DD" }
      v.data = s
    } else if (k === "loja") {
      const s = texto("loja")?.toUpperCase()
      if (!s || !(LOJAS_DEVOLUCAO as readonly string[]).includes(s)) return { error: `loja deve ser ${LOJAS_DEVOLUCAO.join(" ou ")}` }
      v.loja = s
    } else if (k === "situacao") {
      const s = texto("situacao")
      if (!s || !(SITUACOES_DEVOLUCAO as readonly string[]).includes(s)) return { error: `situacao deve ser: ${SITUACOES_DEVOLUCAO.join(", ")}` }
      v.situacao = s
    } else if (k === "origem") {
      const s = texto("origem")
      if (!s || !(ORIGENS_DEVOLUCAO as readonly string[]).includes(s)) return { error: "origem deve ser robo ou manual" }
      v.origem = s
    } else if (k === "sku") {
      const s = texto("sku")
      if (!s) return { error: "sku é obrigatório" }
      v.sku = s
    } else {
      v[k] = texto(k)
    }
  }
  return { valores: v }
}
