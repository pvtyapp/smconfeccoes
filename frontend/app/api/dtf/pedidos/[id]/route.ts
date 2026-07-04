import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { deleteBlobs } from "@/lib/blob-cleanup"

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
        p.impressora_id AS "impressoraId",
        p.contact_id AS "contactId", p.created_at AS "createdAt",
        c.name AS "contactName", c.phone AS "contactPhone", c.jid AS "contactJid",
        c.payment_term_enabled AS "paymentTermEnabled",
        c.payment_term_type    AS "paymentTermType",
        c.payment_term_days    AS "paymentTermDays",
        COALESCE(
          json_agg(
            json_build_object(
              'id',       a.id,
              'blobUrl',  COALESCE(a.blob_url, wm.media_data),
              'filename', COALESCE(a.filename, wm.file_name),
              'mimeType', a.mime_type
            )
            ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL), '[]'
        ) AS attachments
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      LEFT JOIN dtf_order_attachments a ON a.pedido_id = p.id
      LEFT JOIN wa_messages wm ON wm.id = a.wa_message_id
      WHERE p.id = $1
      GROUP BY p.id, c.id
    `, [id])
    if (!rows[0]) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { isPaid?: boolean | null; impressoraId?: number | null }
    await pool.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS is_paid BOOLEAN`).catch(() => {})
    const cols: string[]   = []
    const vals: unknown[]  = []
    if (body.isPaid !== undefined)     { vals.push(body.isPaid ?? null);      cols.push(`is_paid = $${vals.length}`) }
    if (body.impressoraId !== undefined) { vals.push(body.impressoraId ?? null); cols.push(`impressora_id = $${vals.length}`) }
    if (cols.length) {
      vals.push(id)
      await pool.query(`UPDATE dtf_pedidos SET ${cols.join(", ")} WHERE id = $${vals.length}`, vals)
    }
    return NextResponse.json({ ok: true })
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
    const { rows } = await pool.query<{ blob_url: string }>(
      `SELECT blob_url FROM dtf_order_attachments WHERE pedido_id = $1 AND blob_url LIKE 'https://%'`,
      [id]
    )
    if (rows.length) await deleteBlobs(rows.map(r => r.blob_url))
    await pool.query(`DELETE FROM dtf_pedidos WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
