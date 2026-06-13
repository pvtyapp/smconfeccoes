import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(`
      SELECT
        p.id, p.number, p.data, p.cliente, p.metros,
        p.metros_finais AS "metrosFinais", p.largura_cm AS "larguraCm",
        p.preco_cobrado AS "precoCobrado", p.observacao,
        p.status, p.source, p.due_date AS "dueDate",
        p.contact_id AS "contactId", p.created_at AS "createdAt",
        c.name AS "contactName", c.phone AS "contactPhone", c.jid AS "contactJid",
        c.payment_term_enabled AS "paymentTermEnabled",
        c.payment_term_type    AS "paymentTermType",
        c.payment_term_days    AS "paymentTermDays",
        COALESCE(
          json_agg(
            json_build_object('id', a.id, 'blobUrl', a.blob_url, 'filename', a.filename, 'mimeType', a.mime_type)
            ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL), '[]'
        ) AS attachments
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      LEFT JOIN dtf_order_attachments a ON a.pedido_id = p.id
      WHERE p.id = $1
      GROUP BY p.id, c.id
    `, [id])
    if (!rows[0]) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await pool.query(`DELETE FROM dtf_pedidos WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
