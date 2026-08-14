import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

// POST /api/orders/[id]/alert-alteration
// Dispara pro cliente o aviso de alteração do pedido em em_separacao — tanto no
// caso automático (dedução de estoque não bateu 100%, usa order.stockAlert pros
// bullets) quanto no caso manual (operador editou a quantidade pelo stepper, sem
// stockAlert; manda só a lista atualizada). Depois disso o card mostra Cancelar /
// Confirmar Alteração — o segundo reaproveita o mesmo POST /status com status
// "pronto" (mesma mensagem final do caminho sem alteração).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { rows } = await pool.query(`
      SELECT o.id, o.number, o.contact_id, o.stock_alert AS "stockAlert",
             c.jid AS jid
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = $1
    `, [id])

    const order = rows[0] as {
      id: number; number: string; contact_id: number
      stockAlert: { productName: string; color: string; size: string; requested: number; available: number }[] | null
      jid: string | null
    } | undefined

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (!order.jid) return NextResponse.json({ error: "Contato sem WhatsApp vinculado" }, { status: 400 })

    const { rows: itemRows } = await pool.query(`
      SELECT product_name, color, size, qty::int AS qty, qty_confirmed::int AS "qtyConfirmed", unit_price AS "unitPrice"
      FROM order_items WHERE order_id = $1 ORDER BY id
    `, [id])

    const bullets = (order.stockAlert ?? []).map(a => {
      const label = [a.productName, a.color, a.size].filter(Boolean).join(" ")
      return a.available === 0
        ? `• *${label}*: sem estoque`
        : `• *${label}*: somente *${a.available}*`
    })

    const lines = itemRows
      .filter((it: { qtyConfirmed: number | null }) => (it.qtyConfirmed ?? 1) > 0 || it.qtyConfirmed === null)
      .map((it: { product_name: string; color: string; size: string; qty: number; qtyConfirmed: number | null }, idx: number) => {
        const desc = [it.product_name, it.color, it.size].filter(Boolean).join(" ")
        const qty  = it.qtyConfirmed ?? it.qty
        return `${idx + 1}. ${desc} · *${qty} un*`
      })

    const total = itemRows.reduce((s: number, it: { qty: number; qtyConfirmed: number | null; unitPrice: number | null }) =>
      s + (it.qtyConfirmed ?? it.qty) * Number(it.unitPrice ?? 0), 0)
    const valor = total > 0 ? `\n\n💰 Novo total: *R$ ${total.toFixed(2).replace(".", ",")}*` : ""

    const intro = bullets.length > 0
      ? `Atenção, atualizamos alguns itens do seu pedido:\n${bullets.join("\n")}\n\nSeu pedido ficou assim:\n\n`
      : `Atenção, seu pedido foi atualizado. Ficou assim:\n\n`
    const msg = `${intro}${lines.join("\n")}${valor}\n\nPode separar assim mesmo?`

    sendAndSave(order.contact_id, order.jid, msg).catch(() => {})
    await pool.query(`UPDATE orders SET alteration_sent = true WHERE id = $1`, [id])

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
