import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { todayBR } from "@/lib/tz"

export async function POST(req: Request) {
  try {
    const { contactId, waMessageId, fileName, mimeType } = await req.json() as {
      contactId: number
      waMessageId: number
      fileName: string | null
      mimeType: string | null
    }

    if (!contactId || !waMessageId)
      return NextResponse.json({ error: "contactId, waMessageId obrigatórios" }, { status: 400 })

    // Busca o arquivo direto do banco (banco-a-banco) em vez de recebê-lo no corpo
    // da requisição — o navegador só manda o id da mensagem. Arquivo em base64
    // trafegando ida e volta pelo navegador estourava o limite de ~4.5MB de
    // payload de Function da Vercel pra arquivos um pouco maiores que 3MB.
    const mediaRes = await pool.query(
      `SELECT media_data AS "mediaData", COALESCE(media_failed, false) AS "mediaFailed" FROM wa_messages WHERE id = $1`,
      [waMessageId]
    )
    const media = mediaRes.rows[0] as { mediaData: string | null; mediaFailed: boolean } | undefined
    if (!media) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 })
    if (media.mediaFailed) return NextResponse.json({ error: "Falha no download desse arquivo — peça pro cliente reenviar" }, { status: 422 })
    if (!media.mediaData) return NextResponse.json({ error: "Arquivo ainda processando — tente de novo em instantes" }, { status: 409 })
    const fileUrl = media.mediaData

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
