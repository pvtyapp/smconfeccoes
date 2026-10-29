import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"
import { LOJAS_MKT, paraNumero, arred, avisosDe, type LojaMkt } from "@/lib/mktFechamento"
import { SELECT_FECHAMENTO, FROM_FECHAMENTO, comLucro, lerFechamento, recalcularCustos, quemEsta } from "@/lib/mktFechamentoDb"
import { exigirFinanceiro } from "@/lib/acesso"

// Fechamento diário do marketplace (SHP_MARI, SHP_SAMU, TKTK_SAMU). Mesma sessão do painel:
// o agente do outro PC chama de dentro do navegador logado, igual às devoluções.
// Formato completo e exemplo: aba Marketplace → Lançamentos → "Como lançar".

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

// GET /api/marketplace/fechamento?from=YYYY-MM-DD&to=YYYY-MM-DD&loja= → lista com lucro e avisos
export async function GET(req: Request) {
  const semPermissao = await exigirFinanceiro()
  if (semPermissao) return semPermissao

  const p = new URL(req.url).searchParams
  const from = p.get("from") ?? ""
  const to = p.get("to") ?? ""
  const loja = p.get("loja")?.trim().toUpperCase() || null
  if (!DIA_RE.test(from) || !DIA_RE.test(to)) return erro("from e to são obrigatórios (YYYY-MM-DD)")
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FECHAMENTO} FROM ${FROM_FECHAMENTO}
       WHERE f.dia BETWEEN $1 AND $2 AND ($3::text IS NULL OR f.loja = $3)
       ORDER BY f.dia DESC, f.loja`, [from, to, loja])
    return NextResponse.json(rows.map(r => { const f = comLucro(r); return { ...f, avisos: avisosDe(f) } }))
  } catch (e) {
    return erro(e instanceof Error ? e.message : String(e), 500)
  }
}

type ItemIn = { pedido: string | null; sku: string | null; titulo: string | null; variacao: string | null; qtd: number; valor: number; taxa: number; cupom: number; frete: number }

// POST /api/marketplace/fechamento → grava o dia + loja. Se já existe, SUBSTITUI (totais e itens).
// Corpo: { dia, loja, pedidos?, vendas?, taxas?, cupom?, frete?, ads?, pedidosUpseller?, repasse?,
//          observacao?, origem?, itens?: [{ pedido, sku, titulo, variacao, qtd, valor, taxa?, cupom?, frete? }] }
// Total que não vier é somado dos itens. Taxa/cupom/frete/ads sempre positivos (o sistema subtrai).
// Resposta: { ok, id, substituido, fechamento, avisos }
export async function POST(req: Request) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return erro("corpo JSON inválido") }
  if (!b || typeof b !== "object" || Array.isArray(b)) return erro("corpo JSON inválido")

  const dia = String(b.dia ?? "").trim()
  if (!DIA_RE.test(dia)) return erro("dia é obrigatório (YYYY-MM-DD)")
  if (dia > todayBR()) return erro("dia no futuro")
  const loja = String(b.loja ?? "").trim().toUpperCase() as LojaMkt
  if (!LOJAS_MKT.includes(loja)) return erro(`loja inválida: use ${LOJAS_MKT.join(", ")}`)
  const origem = b.origem === "manual" ? "manual" : "robo"

  // números do corpo: null = não veio
  const num = (k: string, inteiro = false): number | null | string => {
    const n = paraNumero(b[k])
    if (n === null) return null
    if (Number.isNaN(n)) return `${k} não é número`
    if (inteiro && (!Number.isInteger(n) || n < 0)) return `${k} deve ser inteiro e não negativo`
    return inteiro ? n : Math.abs(n)
  }
  const campos = {
    pedidos: num("pedidos", true), vendas: num("vendas"), taxas: num("taxas"), cupom: num("cupom"),
    frete: num("frete"), ads: num("ads"), pedidosUpseller: num("pedidosUpseller", true), repasse: num("repasse"),
  }
  for (const v of Object.values(campos)) if (typeof v === "string") return erro(v)
  const c = campos as Record<keyof typeof campos, number | null>

  // itens (opcional)
  let itens: ItemIn[] = []
  if (b.itens !== undefined && b.itens !== null) {
    if (!Array.isArray(b.itens)) return erro("itens deve ser uma lista")
    const txt = (x: unknown) => (x === null || x === undefined || String(x).trim() === "" ? null : String(x).trim())
    for (let i = 0; i < b.itens.length; i++) {
      const it = b.itens[i] as Record<string, unknown>
      if (!it || typeof it !== "object") return erro(`itens[${i}] inválido`)
      const qtd = paraNumero(it.qtd ?? 1)
      if (qtd === null || Number.isNaN(qtd) || !Number.isInteger(qtd) || qtd < 1) return erro(`itens[${i}].qtd deve ser inteiro maior que zero`)
      const n: Record<string, number> = {}
      for (const k of ["valor", "taxa", "cupom", "frete"]) {
        const v = paraNumero(it[k])
        if (Number.isNaN(v)) return erro(`itens[${i}].${k} não é número`)
        n[k] = Math.abs(v ?? 0)
      }
      if (!txt(it.sku) && !txt(it.titulo)) return erro(`itens[${i}] precisa de sku ou titulo`)
      itens.push({ pedido: txt(it.pedido), sku: txt(it.sku), titulo: txt(it.titulo), variacao: txt(it.variacao), qtd, valor: n.valor, taxa: n.taxa, cupom: n.cupom, frete: n.frete })
    }
  }
  const temItens = itens.length > 0
  const soma = (k: "valor" | "taxa" | "cupom" | "frete") => arred(itens.reduce((s, it) => s + it[k], 0))
  const pedidosItens = new Set(itens.map(it => it.pedido).filter(Boolean)).size

  const total = {
    pedidos: c.pedidos ?? (temItens ? pedidosItens : null),
    vendas: c.vendas ?? (temItens ? soma("valor") : null),
    taxas: c.taxas ?? (temItens ? soma("taxa") : 0),
    cupom: c.cupom ?? (temItens ? soma("cupom") : 0),
    frete: c.frete ?? (temItens ? soma("frete") : 0),
    ads: c.ads ?? 0,
  }
  if (total.pedidos === null) return erro("mande pedidos (ou os itens com o número do pedido)")
  if (total.vendas === null) return erro("mande vendas (ou os itens com o valor)")
  const pecas = temItens ? itens.reduce((s, it) => s + it.qtd, 0) : (paraNumero(b.pecas) ?? 0)
  if (!Number.isInteger(pecas) || pecas < 0) return erro("pecas deve ser inteiro e não negativo")
  const observacao = b.observacao === undefined || b.observacao === null ? null : String(b.observacao).trim() || null

  const quem = await quemEsta()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows: antes } = await client.query("SELECT id FROM marketplace_fechamentos WHERE dia = $1 AND loja = $2", [dia, loja])
    const { rows } = await client.query(`
      INSERT INTO marketplace_fechamentos
        (dia, loja, pedidos, pecas, vendas, taxas, cupom, frete, ads, custo, itens_sem_custo,
         pedidos_upseller, repasse, observacao, origem, atualizado_por, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,0,$10,$11,$12,$13,$14, now())
      ON CONFLICT (dia, loja) DO UPDATE SET
        pedidos = EXCLUDED.pedidos, pecas = EXCLUDED.pecas, vendas = EXCLUDED.vendas, taxas = EXCLUDED.taxas,
        cupom = EXCLUDED.cupom, frete = EXCLUDED.frete, ads = EXCLUDED.ads, custo = NULL, itens_sem_custo = 0,
        pedidos_upseller = EXCLUDED.pedidos_upseller, repasse = EXCLUDED.repasse, observacao = EXCLUDED.observacao,
        origem = EXCLUDED.origem, atualizado_por = EXCLUDED.atualizado_por, updated_at = now()
      RETURNING id`,
      [dia, loja, total.pedidos, pecas, total.vendas, total.taxas, total.cupom, total.frete, total.ads,
       c.pedidosUpseller, c.repasse, observacao, origem, quem])
    const id = rows[0].id as number

    await client.query("DELETE FROM marketplace_vendas_itens WHERE dia = $1 AND loja = $2", [dia, loja])
    for (const it of itens) {
      await client.query(
        `INSERT INTO marketplace_vendas_itens (dia, loja, pedido, sku, titulo, variacao, qtd, valor, taxa, cupom, frete)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [dia, loja, it.pedido, it.sku, it.titulo, it.variacao, it.qtd, it.valor, it.taxa, it.cupom, it.frete])
    }
    if (temItens) await recalcularCustos(client, { dia, loja })
    await client.query("COMMIT")

    const f = (await lerFechamento(pool, id))!
    return NextResponse.json({ ok: true, id, substituido: antes.length > 0, fechamento: f, avisos: avisosDe(f) })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    return erro(e instanceof Error ? e.message : String(e), 500)
  } finally {
    client.release()
  }
}
