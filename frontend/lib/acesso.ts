import { cache } from "react"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"

// Valores em R$ por usuário (PIV 28/10): duas permissões além das abas.
//  - verPreco:      preço de venda e valor de pedido (quem atende cliente no PDV/pedido)
//  - verFinanceiro: custo, lucro, faturamento, contas, valor de estoque
// Admin vê tudo. Lido do BANCO a cada requisição (não do cookie, que dura 30 dias):
// tirou a permissão, a pessoa para de receber os valores na hora.
export type Acesso = {
  userId: number | null
  isAdmin: boolean
  allowedPages: string[]
  verPreco: boolean
  verFinanceiro: boolean
}

const TUDO: Acesso = { userId: null, isAdmin: true, allowedPages: [], verPreco: true, verFinanceiro: true }

// Usuário que já existia quando a regra entrou continua vendo tudo (DEFAULT true) até o
// PIV revisar um por um; usuário novo nasce sem (o cadastro manda false explícito).
let colunas: Promise<unknown> | null = null
export function garantirColunasAcesso() {
  colunas ??= pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ver_preco      BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ver_financeiro BOOLEAN NOT NULL DEFAULT true;
  `).catch(e => { colunas = null; throw e })
  return colunas
}

export const getAcesso = cache(async (): Promise<Acesso | null> => {
  // Mesmo critério do middleware: fora da produção (dev local) não tem login.
  if (!process.env.AUTH_SECRET || process.env.VERCEL_ENV !== "production") return TUDO
  const session = await getSessionFromRequest()
  if (!session) return null
  await garantirColunasAcesso()
  const { rows } = await pool.query(
    `SELECT is_admin, allowed_pages, active, ver_preco, ver_financeiro FROM users WHERE id = $1`,
    [session.userId]
  )
  const u = rows[0]
  if (!u || !u.active) return null
  if (u.is_admin) return { ...TUDO, userId: session.userId }
  return {
    userId: session.userId,
    isAdmin: false,
    allowedPages: u.allowed_pages ?? [],
    verPreco: !!u.ver_preco,
    verFinanceiro: !!u.ver_financeiro,
  }
})

// Rotas só de financeiro (relatórios, contas, custos): sem a permissão, 403.
export async function exigirFinanceiro(): Promise<NextResponse | null> {
  const a = await getAcesso()
  if (!a) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  if (!a.verFinanceiro) return NextResponse.json({ error: "Sem permissão pra ver valores financeiros" }, { status: 403 })
  return null
}

// Apaga (vira null) os campos de valor que o usuário não pode ver, em qualquer nível do
// JSON. A tela mostra "•••" no lugar; o dado nem sai do servidor.
export function ocultarValores<T>(dados: T, a: Acesso | null, campos: { financeiro?: string[]; preco?: string[] }): T {
  const fora = new Set<string>([
    ...(a?.verFinanceiro ? [] : campos.financeiro ?? []),
    ...(a?.verPreco ? [] : campos.preco ?? []),
  ])
  if (!fora.size) return dados
  const limpar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(limpar)
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fora.has(k) ? null : limpar(x)]))
    }
    return v
  }
  return limpar(dados) as T
}
