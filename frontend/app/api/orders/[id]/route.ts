import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getAcesso, ocultarValores } from "@/lib/acesso"

const CAMPOS_VALOR = { preco: ["unitPrice", "totalValue"] }

async function getOrder(id: string) {
  const { rows } = await pool.query(`
    SELECT
      o.id,
      o.number,
      o.status,
      o.notes,
      o.confirmation_requested_at AS "confirmationRequestedAt",
      o.paid_label   AS "paidLabel",
      o.created_at   AS "createdAt",
      o.updated_at   AS "updatedAt",
      c.id           AS "contactId",
      c.name         AS "contactName",
      c.phone        AS "contactPhone",
      c.jid          AS "contactJid",
      COALESCE(
        json_agg(
          json_build_object(
            'id',           i.id,
            'productId',    i.product_id,
            'productName',  i.product_name,
            'color',        i.color,
            'size',         i.size,
            'qty',          i.qty::int,
            'qtyConfirmed', i.qty_confirmed,
            'isService',    i.is_service,
            'variantNote',  i.variant_note,
            'variantId',    i.variant_id,
            'unitPrice',    i.unit_price::float
          ) ORDER BY i.id
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    JOIN wa_contacts c ON c.id = o.contact_id
    LEFT JOIN order_items i ON i.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id, c.id
  `, [id])
  return rows[0] ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const order = await getOrder(id)
    if (!order) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(ocultarValores(order, await getAcesso(), CAMPOS_VALOR))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json()
    const { notes, items, paidLabel } = body

    await client.query("BEGIN")
    // Trava a linha do pedido por toda a transação — qualquer outro PUT pra
    // esse mesmo id (autosave, outro clique, outra aba) espera essa terminar
    // em vez de rodar em paralelo. Sem isso, duas transações fazendo
    // DELETE+INSERT nos itens ao mesmo tempo podiam duplicar item (cada uma
    // insere sua cópia sem ver a da outra ainda não commitada).
    await client.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [id])

    if (notes !== undefined) {
      await client.query("UPDATE orders SET notes = $1 WHERE id = $2", [notes, id])
    }

    // Selo Pagou/Não pagou — só informativo (Pronto p/ Retirada), não muda nada
    // mais no pedido, é lembrete visual pro operador.
    if (paidLabel !== undefined) {
      await client.query(`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_label BOOLEAN
      `).catch(() => {})
      await client.query("UPDATE orders SET paid_label = $1 WHERE id = $2", [paidLabel, id])
    }

    if (Array.isArray(items)) {
      // Quem não vê preço recebe os itens com unitPrice apagado e devolve assim: o preço
      // nunca vem da tela, sai do item que já estava no pedido ou do cadastro do produto.
      const acesso = await getAcesso()
      const precoDaTela = !!acesso?.verPreco
      const chave = (x: { variantId?: unknown; productId?: unknown; color?: unknown; size?: unknown }) =>
        x.variantId ? `v${x.variantId}` : `p${x.productId}|${x.color ?? ""}|${x.size ?? ""}`
      const precoAntigo = new Map<string, number | null>()
      if (!precoDaTela) {
        const { rows: antigos } = await client.query(
          `SELECT id, product_id AS "productId", variant_id AS "variantId", color, size, unit_price::float AS "unitPrice"
           FROM order_items WHERE order_id = $1`, [id])
        for (const a of antigos) { precoAntigo.set(`i${a.id}`, a.unitPrice); precoAntigo.set(chave(a), a.unitPrice) }
      }
      const precoDoItem = async (item: { id?: unknown; variantId?: unknown; productId?: unknown; color?: unknown; size?: unknown; unitPrice?: number | null }) => {
        if (precoDaTela) return item.unitPrice ?? null
        for (const k of [item.id ? `i${item.id}` : "", chave(item)]) if (k && precoAntigo.has(k)) return precoAntigo.get(k) ?? null
        if (!item.productId) return null
        const { rows: pr } = await client.query(
          `SELECT COALESCE(pv.sale_price, p.sale_price)::float AS preco
           FROM products p LEFT JOIN product_variants pv ON pv.id = $2 AND pv.product_id = p.id
           WHERE p.id = $1`, [item.productId, item.variantId ?? null])
        return pr[0]?.preco ?? null
      }

      // Kanban 3 estágios: estoque não mexe mais aqui em nenhum estágio — só
      // sai de verdade no Concluir Entrega (status=concluido). Editar item em
      // Triagem ou Separação é só dado do pedido, sem efeito colateral no
      // estoque físico até a entrega ser confirmada.
      await client.query("DELETE FROM order_items WHERE order_id = $1", [id])
      for (const item of items) {
        const unitPrice = await precoDoItem(item)
        await client.query(`
          INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, qty_confirmed, variant_id, unit_price, is_service, variant_note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          id, item.productId ?? null, item.productName, item.color ?? null, item.size ?? null, item.qty, item.qtyConfirmed ?? null,
          item.variantId ?? null, unitPrice, item.isService ?? false, item.variantNote ?? null,
        ])
      }
      await client.query(
        `UPDATE orders SET total_value = (
           SELECT COALESCE(SUM(qty * COALESCE(unit_price,0)),0) FROM order_items WHERE order_id = $1
         ) WHERE id = $1`,
        [id]
      )
    }

    await client.query("COMMIT")
    const order = await getOrder(id)
    return NextResponse.json(ocultarValores(order, await getAcesso(), CAMPOS_VALOR))
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
