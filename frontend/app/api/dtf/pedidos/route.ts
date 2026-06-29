import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const source = searchParams.get("source")

    const contactId = searchParams.get("contactId")

    let where = "WHERE 1=1"
    const params: string[] = []
    if (status)    { params.push(status);    where += ` AND p.status = $${params.length}` }
    if (source)    { params.push(source);    where += ` AND p.source = $${params.length}` }
    if (contactId) { params.push(contactId); where += ` AND p.contact_id = $${params.length}` }

    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.number,
        p.data,
        p.cliente,
        p.metros,
        p.metros_finais    AS "metrosFinais",
        p.largura_cm       AS "larguraCm",
        p.preco_cobrado    AS "precoCobrado",
        p.observacao,
        p.status,
        p.source,
        p.due_date         AS "dueDate",
        p.impressora_id    AS "impressoraId",
        p.contact_id       AS "contactId",
        p.created_at       AS "createdAt",
        c.name             AS "contactName",
        c.phone            AS "contactPhone",
        c.jid              AS "contactJid",
        c.payment_term_enabled    AS "paymentTermEnabled",
        c.payment_term_type       AS "paymentTermType",
        c.payment_term_days       AS "paymentTermDays",
        COALESCE(
          json_agg(
            json_build_object(
              'id',       a.id,
              'blobUrl',  COALESCE(a.blob_url, wm.media_data),
              'filename', COALESCE(a.filename, wm.file_name),
              'mimeType', a.mime_type
            ) ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'
        ) AS attachments
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      LEFT JOIN dtf_order_attachments a ON a.pedido_id = p.id
      LEFT JOIN wa_messages wm ON wm.id = a.wa_message_id
      ${where}
      GROUP BY p.id, c.id
      ORDER BY p.created_at DESC, p.id DESC
    `, params)

    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { data, cliente, metros, precoCobrado, observacao, contactId, status, source, larguraCm } = body

    if (!data) return NextResponse.json({ error: "data é obrigatória" }, { status: 400 })

    const numRes = await pool.query(`SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`)
    const number = numRes.rows[0].num

    const { rows } = await pool.query(`
      INSERT INTO dtf_pedidos
        (number, data, cliente, metros, preco_cobrado, observacao, contact_id, status, source, largura_cm)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, number, data, cliente, metros,
        metros_finais AS "metrosFinais", largura_cm AS "larguraCm",
        preco_cobrado AS "precoCobrado", observacao, status, source,
        contact_id AS "contactId", created_at AS "createdAt"
    `, [
      number,
      data,
      cliente ?? null,
      metros ?? null,
      precoCobrado ?? null,
      observacao ?? null,
      contactId ?? null,
      status ?? 'triagem',
      source ?? 'manual',
      larguraCm ?? null,
    ])

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
