import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { notifyClient } = body as { notifyClient?: boolean }

    const { rows } = await pool.query(`
      SELECT p.id, p.number, p.paid_at, p.preco_cobrado, p.contact_id AS "contactId",
             COALESCE(c.phone_jid, c.jid) AS jid, c.name AS "contactName"
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    if (rows[0].paid_at) return NextResponse.json({ success: true, skipped: true })

    await pool.query(`
      UPDATE dtf_pedidos SET paid_at = NOW(), is_paid = true WHERE id = $1
    `, [id])

    if (notifyClient && rows[0].jid) {
      const nome = (rows[0].contactName as string)?.split(" ")[0] ?? ""
      const valor = rows[0].preco_cobrado
        ? ` de *R$ ${Number(rows[0].preco_cobrado).toFixed(2).replace(".", ",")}*`
        : ""
      sendAndSave(
        rows[0].contactId as number,
        rows[0].jid,
        `Pagamento${valor} do pedido *${rows[0].number}* confirmado! Obrigado${nome ? `, ${nome}` : ""} 🙏`
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
