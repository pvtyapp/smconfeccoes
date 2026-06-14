import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { cleanDtfBlobsOnConclude } from "@/lib/blob-cleanup"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, p.created_at AS pedido_created_at
      FROM dtf_pedidos p
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const pedido = rows[0]

    await client.query(`
      UPDATE dtf_pedidos
      SET status       = 'concluido',
          concluded_at = NOW()
      WHERE id = $1
    `, [id])

    if (pedido.contact_id) {
      await client.query(`
        UPDATE wa_contacts
        SET last_order_at        = NOW(),
            lifecycle_state      = 'active',
            lifecycle_updated_at = NOW(),
            ausente_seq          = 0
        WHERE id = $1
      `, [pedido.contact_id])
    }

    await client.query("COMMIT")

    // Free DTF blobs (fire-and-forget)
    if (pedido.contact_id) {
      cleanDtfBlobsOnConclude(pedido.contact_id, new Date(pedido.pedido_created_at)).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
