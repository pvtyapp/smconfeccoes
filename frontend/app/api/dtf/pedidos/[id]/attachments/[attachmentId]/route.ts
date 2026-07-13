import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { deleteBlobs } from "@/lib/blob-cleanup"

// Remove um anexo específico do pedido (arquivo vinculado errado por engano) —
// sem precisar apagar o pedido inteiro pra corrigir.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id, attachmentId } = await params
    const { rows } = await pool.query<{ blob_url: string | null }>(
      `SELECT blob_url FROM dtf_order_attachments WHERE id = $1 AND pedido_id = $2`,
      [attachmentId, id]
    )
    if (!rows[0]) return NextResponse.json({ error: "Anexo não encontrado nesse pedido" }, { status: 404 })

    if (rows[0].blob_url?.startsWith("https://")) {
      await deleteBlobs([rows[0].blob_url]).catch(() => {})
    }

    await pool.query(`DELETE FROM dtf_order_attachments WHERE id = $1 AND pedido_id = $2`, [attachmentId, id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
