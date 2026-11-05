import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"
import { precoMetroDtf } from "@/lib/dtfPreco"

type Queryable = { query: typeof pool.query }

export type ItemCarrinho = {
  variantId: string
  productId: string
  productName: string
  color: string | null
  size: string | null
  qty: number
  unitPrice: number
}

// Carrinho guardado junto da solicitação de cliente novo (PIV 05/11: "o pedido
// vai junto com a aprovação, pra não perder o carrinho"). Preço e nome sempre
// do banco, nunca do navegador; o cliente só manda variantId + qty + metros.
export type CarrinhoSite = { itens: ItemCarrinho[]; dtfMetros: number; total: number }

export async function montarCarrinho(
  db: Queryable,
  itens: { variantId: string; qty: number }[],
  dtfMetros: number
): Promise<CarrinhoSite> {
  const qtd = new Map<string, number>()
  for (const i of Array.isArray(itens) ? itens : []) {
    const q = Math.floor(Number(i?.qty) || 0)
    if (typeof i?.variantId === "string" && q > 0) qtd.set(i.variantId, (qtd.get(i.variantId) ?? 0) + q)
  }
  let lista: ItemCarrinho[] = []
  if (qtd.size) {
    const { rows } = await db.query(`
      SELECT pv.id AS "variantId", pv.product_id AS "productId", p.name AS "productName", pv.color, pv.size,
             COALESCE(pv.sale_price, p.sale_price, 0) AS "unitPrice"
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ANY($1) AND pv.status = 'active'
    `, [[...qtd.keys()]])
    lista = rows.map((r) => ({ ...r, unitPrice: Number(r.unitPrice), qty: qtd.get(r.variantId)! }))
  }
  const metros = Math.max(0, Math.floor(Number(dtfMetros) || 0))
  const dtf = metros ? await precoMetroDtf(db) : null
  const total = lista.reduce((s, i) => s + i.unitPrice * i.qty, 0) + (dtf ? dtf.precoMetro * metros : 0)
  return { itens: lista, dtfMetros: metros, total }
}

// DTF pedido pelo site entra na triagem do DTF, igual o que chega pelo WhatsApp:
// a arte vem depois, no WhatsApp. Os metros pedidos ficam no aviso do card.
export async function criarPedidoDtfSite(db: Queryable, contactId: number, metros: number): Promise<string> {
  const numRes = await db.query(`SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`)
  const number = numRes.rows[0].num as string
  await db.query(
    `INSERT INTO dtf_pedidos (number, data, contact_id, status, source, largura_cm, attention_reason)
     VALUES ($1, $2, $3, 'triagem', 'site', 60, $4)`,
    [number, todayBR(), contactId, `Pedido do site: ${metros} m de DTF 60 cm. Pedir a arte no WhatsApp.`]
  )
  return number
}

// Pedido de peças a partir do carrinho guardado (cliente novo aprovado). Nasce
// em triagem: o estoque não foi travado na hora do pedido (o cliente ainda não
// tinha conta), então a equipe confere antes de separar.
export async function criarPedidoDoCarrinho(db: Queryable, contactId: number, itens: ItemCarrinho[], nota: string): Promise<string | null> {
  if (!itens.length) return null
  const total = itens.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const numRes = await db.query("SELECT nextval('order_number_seq') AS n")
  const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`
  const { rows } = await db.query(
    `INSERT INTO orders (number, contact_id, status, source, total_value) VALUES ($1, $2, 'triagem', 'site', $3) RETURNING id`,
    [number, contactId, total]
  )
  const orderId = rows[0].id
  for (const i of itens) {
    await db.query(`
      INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, unit_price, is_service, variant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
    `, [orderId, i.productId, i.productName, i.color, i.size, i.qty, i.unitPrice, i.variantId])
  }
  await db.query(`INSERT INTO order_events (order_id, status, actor, note) VALUES ($1, 'triagem', 'site', $2)`, [orderId, nota])
  return number
}

// Colunas novas, criadas na primeira vez que alguém usa (mesmo padrão do
// hero_banners na home): não precisa rodar migração à parte. password_hash =
// senha que a pessoa já escolheu ao criar a conta com a trava de aprovação ligada.
export async function garantirColunasSolicitacao(db: Queryable = pool) {
  await db.query(`ALTER TABLE fornecedor_solicitacoes ADD COLUMN IF NOT EXISTS carrinho JSONB`)
  await db.query(`ALTER TABLE fornecedor_solicitacoes ADD COLUMN IF NOT EXISTS password_hash TEXT`)
}

// Trava de aprovação de cadastro novo (Configurações → Cadastro no site).
// Desligada por padrão (PIV 05/11): confirmou o código, a conta já está ativa.
export async function aprovacaoCadastroLigada(db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query(`SELECT value FROM app_settings WHERE key = 'portal_aprovacao_cadastro'`)
  return rows[0]?.value === "true"
}

export function resumoCarrinho(c: CarrinhoSite): string {
  const linhas = c.itens.map((i) => `${i.qty}x ${i.productName}${[i.color, i.size].filter(Boolean).length ? ` (${[i.color, i.size].filter(Boolean).join(", ")})` : ""}`)
  if (c.dtfMetros) linhas.push(`${c.dtfMetros} m de DTF 60 cm`)
  return linhas.join("\n")
}
