// Estoque mínimo e alvo (PIV 14/11/2026): cada produto/cor/tamanho tem um MÍNIMO (dispara o
// aviso de produzir) e um ALVO (até quanto produzir). Campos já existiam em product_variants
// (min_stock, target_stock) mas nunca foram preenchidos. O aviso vai no grupo SM Administrativo,
// só quando a variante CRUZA o mínimo (não a cada venda), e rearma quando a produção repõe.
// Saldo usado = disponível de verdade (estoque menos o que está comprometido em pedido aberto),
// igual o Estoque/Marketplace mostram.
import { pool } from "@/lib/db"
import { sendAdministrativo } from "@/lib/whatsapp/administrativoGroup"

export type VarianteSaldo = {
  variantId: string; productId: string; productName: string; color: string; size: string; sizeIdx: number
  minStock: number; targetStock: number; disponivel: number; vendas30: number
}

export async function saldosVariantes(): Promise<VarianteSaldo[]> {
  const { rows } = await pool.query(`
    SELECT pv.id AS "variantId", pv.product_id AS "productId", p.name AS "productName", pv.color, pv.size,
           COALESCE(array_position(p.size_list, pv.size), 99) AS "sizeIdx",
           COALESCE(pv.min_stock, 0)::int AS "minStock", COALESCE(pv.target_stock, 0)::int AS "targetStock",
           (COALESCE(bal.qty, 0) - COALESCE(locked.qty, 0))::int AS disponivel,
           COALESCE(s30.qty, 0)::int AS vendas30
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN (SELECT variant_id, SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END) AS qty
                   FROM stock_movements GROUP BY variant_id) bal ON bal.variant_id = pv.id
      LEFT JOIN (SELECT variant_id, SUM(quantity) AS qty FROM stock_movements
                  -- só venda: ajuste de estoque ("manutencao", ex.: -371 numa atualização) não é giro
                  WHERE type='out' AND reason <> 'manutencao' AND created_at >= NOW() - INTERVAL '30 days' GROUP BY variant_id) s30 ON s30.variant_id = pv.id
      LEFT JOIN (SELECT oi.variant_id, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE o.status IN ('triagem','em_separacao','pronto') AND oi.variant_id IS NOT NULL
                  GROUP BY oi.variant_id) locked ON locked.variant_id = pv.id
     WHERE pv.status = 'active' AND p.status = 'active'
     ORDER BY p.name, pv.color, 6
  `)
  return rows.map(r => ({ ...r, minStock: Number(r.minStock), targetStock: Number(r.targetStock), disponivel: Number(r.disponivel), vendas30: Number(r.vendas30), sizeIdx: Number(r.sizeIdx) }))
}

export const aProduzir = (v: VarianteSaldo) => Math.max(0, (v.targetStock > v.minStock ? v.targetStock : v.minStock) - v.disponivel)
export const abaixoDoMinimo = (v: VarianteSaldo) => v.minStock > 0 && v.disponivel <= v.minStock

// bolinha da cor pra mensagem do WhatsApp (por palavra-chave do nome)
export function bolinhaCor(cor: string): string {
  const n = cor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const mapa: [string, string][] = [["preto", "⚫"], ["off white", "⚪"], ["branco", "⚪"], ["vermelh", "🔴"], ["bordo", "🟥"], ["vinho", "🟥"],
    ["azul", "🔵"], ["verde", "🟢"], ["roxo", "🟣"], ["roxa", "🟣"], ["lilas", "🟣"], ["rosa", "🩷"], ["marrom", "🟤"], ["bege", "🟤"],
    ["amarel", "🟡"], ["laranja", "🟠"], ["cinza", "🩶"], ["mescla", "🩶"]]
  return mapa.find(([k]) => n.includes(k))?.[1] ?? "▪️"
}

const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR")
// PIV 15/11: um bloco por produto, a cor como subtítulo e um tamanho por linha
//   👕 *CAMISETAS ADULTO* · produzir *1.234*
//   ⚫ *Preto*
//      ▸ G: tem *9* · mín 240 · produzir *581*
export function blocosProduzir(vs: VarianteSaldo[]): string[] {
  const porProd = new Map<string, Map<string, VarianteSaldo[]>>()
  for (const v of [...vs].sort((a, b) => a.productName.localeCompare(b.productName) || a.color.localeCompare(b.color) || a.sizeIdx - b.sizeIdx)) {
    const cores = porProd.get(v.productName) ?? new Map<string, VarianteSaldo[]>()
    cores.set(v.color, [...(cores.get(v.color) ?? []), v])
    porProd.set(v.productName, cores)
  }
  const out: string[] = []
  for (const [p, cores] of porProd) {
    const total = [...cores.values()].flat().reduce((s, v) => s + aProduzir(v), 0)
    out.push(`👕 *${p.toUpperCase()}* · produzir *${n0(total)}*`)
    for (const [c, xs] of cores) {
      out.push(`${bolinhaCor(c)} *${c}*`)
      for (const v of xs) out.push(`     ▸ ${v.size}: tem *${n0(v.disponivel)}* · mín ${n0(v.minStock)} · produzir *${n0(aProduzir(v))}*${v.disponivel <= 0 ? " ‼️" : ""}`)
    }
    out.push("")
  }
  if (out[out.length - 1] === "") out.pop()
  return out
}

export function mensagemProduzir(vs: VarianteSaldo[], titulo: string): string {
  const zerados = vs.filter(v => v.disponivel <= 0).length
  return `🧵 *${titulo}*${zerados ? ` · ${zerados} zerado${zerados > 1 ? "s" : ""} ‼️` : ""}\n` +
    `_produzir = até o alvo (5 dias de venda)_\n\n${blocosProduzir(vs).join("\n")}\n\n` +
    `*Total pra produzir: ${n0(vs.reduce((s, v) => s + aProduzir(v), 0))} peças*`
}

let pronto = false
async function ensureAlertas() {
  if (pronto) return
  await pool.query(`CREATE TABLE IF NOT EXISTS estoque_alertas (
    variant_id   TEXT PRIMARY KEY,
    alertado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disponivel   INTEGER
  )`)
  pronto = true
}

// Confere quem cruzou o mínimo desde a última vez, avisa o grupo numa mensagem só e marca.
// Quem voltou pra cima do mínimo sai da marcação (rearma). Devolve quantos avisou.
export async function checarMinimos(opts: { avisar?: boolean } = {}): Promise<{ novos: number; abaixo: number; rearmados: number }> {
  await ensureAlertas()
  const vs = await saldosVariantes()
  const { rows } = await pool.query(`SELECT variant_id FROM estoque_alertas`)
  const marcados = new Set(rows.map(r => String(r.variant_id)))
  const abaixo = vs.filter(abaixoDoMinimo)
  const novos = abaixo.filter(v => !marcados.has(v.variantId))
  const rearmar = vs.filter(v => marcados.has(v.variantId) && !abaixoDoMinimo(v)).map(v => v.variantId)
  // variante que saiu do cadastro ou teve o mínimo zerado também rearma
  const ativos = new Set(vs.filter(v => v.minStock > 0).map(v => v.variantId))
  const sumidos = [...marcados].filter(id => !ativos.has(id))
  const tirar = [...new Set([...rearmar, ...sumidos])]
  if (tirar.length) await pool.query(`DELETE FROM estoque_alertas WHERE variant_id = ANY($1)`, [tirar])

  if (novos.length && opts.avisar !== false) {
    await sendAdministrativo(mensagemProduzir(novos, `Produzir: ${novos.length} ${novos.length === 1 ? "item chegou" : "itens chegaram"} no mínimo`))
  }
  if (novos.length) {
    await pool.query(
      `INSERT INTO estoque_alertas (variant_id, disponivel) SELECT * FROM UNNEST($1::text[], $2::int[])
       ON CONFLICT (variant_id) DO NOTHING`,
      [novos.map(v => v.variantId), novos.map(v => v.disponivel)]
    )
  }
  return { novos: novos.length, abaixo: abaixo.length, rearmados: tirar.length }
}

// Grava mínimo/alvo de várias variantes de uma vez (tela Estoque > Mínimo e alvo)
export async function salvarMinimos(itens: { variantId: string; minStock: number; targetStock: number }[]): Promise<number> {
  const limpos = itens
    .map(i => ({ id: String(i.variantId), min: Math.max(0, Math.round(Number(i.minStock) || 0)), alvo: Math.max(0, Math.round(Number(i.targetStock) || 0)) }))
    .filter(i => i.id && i.min <= 100000 && i.alvo <= 100000)
  if (!limpos.length) return 0
  const r = await pool.query(
    `UPDATE product_variants pv SET min_stock = x.min, target_stock = x.alvo
       FROM UNNEST($1::text[], $2::int[], $3::int[]) AS x(id, min, alvo)
      WHERE pv.id::text = x.id`,
    [limpos.map(i => i.id), limpos.map(i => i.min), limpos.map(i => i.alvo)]
  )
  return r.rowCount ?? 0
}
