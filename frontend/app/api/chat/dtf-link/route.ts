import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"

export async function POST(req: Request) {
  try {
    const { contactId, waMessageId, fileUrl, fileName, mimeType } = await req.json() as {
      contactId: number
      waMessageId: number
      fileUrl: string
      fileName: string | null
      mimeType: string | null
    }

    if (!contactId || !waMessageId || !fileUrl)
      return NextResponse.json({ error: "contactId, waMessageId, fileUrl obrigatórios" }, { status: 400 })

    // Idempotent: if already linked, return existing pedido
    const existing = await pool.query(`
      SELECT a.pedido_id, p.number, p.status
      FROM dtf_order_attachments a
      JOIN dtf_pedidos p ON p.id = a.pedido_id
      WHERE a.wa_message_id = $1
      LIMIT 1
    `, [waMessageId])

    if (existing.rows[0]) {
      return NextResponse.json({ pedidoId: existing.rows[0].pedido_id, pedidoNumber: existing.rows[0].number, created: false, alreadyLinked: true })
    }

    // Find open pedido (not in em_producao / pronto / concluido / cancelado)
    const openRes = await pool.query(`
      SELECT id, number FROM dtf_pedidos
      WHERE contact_id = $1
        AND status NOT IN ('em_producao', 'pronto', 'concluido', 'cancelado')
      ORDER BY created_at DESC LIMIT 1
    `, [contactId])

    let pedidoId: number
    let pedidoNumber: string
    let created = false

    if (openRes.rows[0]) {
      pedidoId     = openRes.rows[0].id
      pedidoNumber = openRes.rows[0].number
    } else {
      // Create new pedido in triagem
      const numRes = await pool.query(`SELECT 'DTF-' || LPAD(nextval('dtf_order_number_seq')::text, 4, '0') AS num`)
      pedidoNumber = numRes.rows[0].num
      const newPedido = await pool.query(`
        INSERT INTO dtf_pedidos (number, data, contact_id, status, source)
        VALUES ($1, $2, $3, 'triagem', 'whatsapp')
        RETURNING id
      `, [pedidoNumber, todayBR(), contactId])
      pedidoId = newPedido.rows[0].id
      created = true
    }

    await pool.query(`
      INSERT INTO dtf_order_attachments (pedido_id, blob_url, filename, mime_type, wa_message_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [pedidoId, fileUrl, fileName, mimeType, waMessageId])

    return NextResponse.json({ pedidoId, pedidoNumber, created })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
