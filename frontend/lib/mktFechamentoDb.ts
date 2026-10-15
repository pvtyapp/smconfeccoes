// Parte de banco do fechamento do marketplace (migration 020). Só no servidor.
import type { PoolClient } from "pg"
import { cookies } from "next/headers"
import { pool } from "@/lib/db"
import { verifySession, COOKIE_NAME } from "@/lib/session"
import { custoDoSku, arred, lucroDe, type FechamentoMkt, type RegraCusto } from "@/lib/mktFechamento"

type Db = Pick<PoolClient, "query">

// Quem está logado (pro "atualizado por"). O robô usa a sessão do navegador onde roda.
export async function quemEsta(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  const s = await verifySession(token)
  return s?.name ?? null
}

export const SELECT_FECHAMENTO = `
  f.id, to_char(f.dia, 'YYYY-MM-DD') AS dia, f.loja, f.pedidos, f.pecas,
  f.vendas::float AS vendas, f.taxas::float AS taxas, f.cupom::float AS cupom, f.frete::float AS frete,
  f.ads::float AS ads, f.custo::float AS custo, f.itens_sem_custo AS "itensSemCusto",
  COALESCE(it.qtd_itens, 0)::int AS "qtdItens", COALESCE(it.soma, 0)::float AS "somaItens",
  f.pedidos_upseller AS "pedidosUpseller", f.repasse::float AS repasse, f.observacao, f.origem,
  f.atualizado_por AS "atualizadoPor", f.updated_at AS "updatedAt"`

export const FROM_FECHAMENTO = `
  marketplace_fechamentos f
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS qtd_itens, SUM(valor) AS soma FROM marketplace_vendas_itens i
    WHERE i.dia = f.dia AND i.loja = f.loja
  ) it ON true`

export function comLucro(row: Omit<FechamentoMkt, "lucro">): FechamentoMkt {
  return { ...row, lucro: lucroDe(row) }
}

export async function lerFechamento(db: Db, id: number): Promise<FechamentoMkt | null> {
  const { rows } = await db.query(`SELECT ${SELECT_FECHAMENTO} FROM ${FROM_FECHAMENTO} WHERE f.id = $1`, [id])
  return rows[0] ? comLucro(rows[0]) : null
}

// Regras com o custo por peça já somado (material_cost atual dos produtos + extra).
export async function carregarRegras(db: Db = pool): Promise<RegraCusto[]> {
  const { rows } = await db.query(`
    SELECT r.id, r.prefixo, r.nome, r.produtos::text[] AS produtos, r.extra::float AS extra,
      (r.extra + COALESCE((SELECT SUM(p.material_cost) FROM products p WHERE p.id = ANY(r.produtos)), 0))::float AS "custoUnitario",
      (SELECT COUNT(*) FROM products p WHERE p.id = ANY(r.produtos) AND p.material_cost IS NULL)::int AS "produtosSemCusto"
    FROM marketplace_custos r ORDER BY length(r.prefixo) DESC, r.prefixo`)
  return rows
}

// Recalcula custo de todos os itens (ou só de um dia + loja) e atualiza custo/itens_sem_custo
// dos fechamentos que têm itens. Fechamento sem item nenhum não é tocado.
export async function recalcularCustos(db: Db, filtro?: { dia: string; loja: string }) {
  const regras = await carregarRegras(db)
  const { rows: itens } = await db.query(
    `SELECT id, sku, qtd, titulo, variacao FROM marketplace_vendas_itens ${filtro ? "WHERE dia = $1 AND loja = $2" : ""}`,
    filtro ? [filtro.dia, filtro.loja] : [])
  const semSku = itens.some(it => !it.sku?.trim())
  const acharSku = semSku ? await skuPorSemelhanca(db, regras) : null
  // agrupa por custo pra mandar poucos UPDATEs
  const porCusto = new Map<string, number[]>()
  for (const it of itens) {
    const c = custoDoSku(regras, it.sku?.trim() ? it.sku : acharSku?.(it.titulo, it.variacao))
    const k = c ? String(arred(c.unitario * it.qtd)) : "null"
    const l = porCusto.get(k) ?? []
    l.push(it.id)
    porCusto.set(k, l)
  }
  for (const [k, ids] of porCusto) {
    await db.query(`UPDATE marketplace_vendas_itens SET custo = $1 WHERE id = ANY($2::int[])`, [k === "null" ? null : Number(k), ids])
  }
  await db.query(`
    UPDATE marketplace_fechamentos f SET
      custo = s.custo, itens_sem_custo = s.sem_custo
    FROM (
      SELECT dia, loja, COALESCE(SUM(custo), 0) AS custo, COUNT(*) FILTER (WHERE custo IS NULL) AS sem_custo
      FROM marketplace_vendas_itens ${filtro ? "WHERE dia = $1 AND loja = $2" : ""}
      GROUP BY dia, loja
    ) s
    WHERE f.dia = s.dia AND f.loja = s.loja`, filtro ? [filtro.dia, filtro.loja] : [])
}

// Item que chegou sem SKU (o extrato do TikTok às vezes não traz): usa o SKU de outra venda do
// mesmo anúncio com o mesmo tipo de variação ("KIT ..." x "Camiseta ..."); se não houver, o
// prefixo de regra que domina esse tipo de variação (>= 90% das vendas com SKU).
async function skuPorSemelhanca(db: Db, regras: RegraCusto[]) {
  const tipo = (v: string | null) => (v ?? "").trim().split(/[\s,]+/)[0].toLowerCase()
  const { rows } = await db.query(`
    SELECT titulo, variacao, sku FROM marketplace_vendas_itens WHERE sku IS NOT NULL AND trim(sku) <> ''`)
  const porAnuncio = new Map<string, string>()
  const porTipo = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const t = tipo(r.variacao)
    if (!t) continue
    const regra = custoDoSku(regras, r.sku)?.regra
    if (!regra) continue
    porAnuncio.set(`${r.titulo}\u0000${t}`, r.sku)
    const m = porTipo.get(t) ?? new Map<string, number>()
    m.set(regra.prefixo, (m.get(regra.prefixo) ?? 0) + 1)
    porTipo.set(t, m)
  }
  const dominante = new Map<string, string>()
  for (const [t, m] of porTipo) {
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    const [prefixo, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    if (n / total >= 0.9) dominante.set(t, prefixo)
  }
  return (titulo: string | null, variacao: string | null): string | null => {
    const t = tipo(variacao)
    if (!t) return null
    return porAnuncio.get(`${titulo}\u0000${t}`) ?? dominante.get(t) ?? null
  }
}

// SKUs vendidos que não caem em nenhuma regra (pra tela de custos).
export async function skusSemCusto(db: Db = pool) {
  const { rows } = await db.query(`
    SELECT sku, MAX(titulo) AS titulo, SUM(qtd)::int AS qtd, COUNT(DISTINCT loja)::int AS lojas,
      to_char(MAX(dia), 'YYYY-MM-DD') AS "ultimoDia"
    FROM marketplace_vendas_itens WHERE custo IS NULL
    GROUP BY sku ORDER BY SUM(qtd) DESC LIMIT 200`)
  return rows as { sku: string | null; titulo: string | null; qtd: number; lojas: number; ultimoDia: string }[]
}
