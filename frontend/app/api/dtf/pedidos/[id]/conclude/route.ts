import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { cleanDtfBlobsOnConclude } from "@/lib/blob-cleanup"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id }    = await params
    const body      = await req.json().catch(() => ({})) as { isPaid?: boolean }
    const isPaid    = body.isPaid !== false  // default true

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, p.created_at AS pedido_created_at,
             p.metros_finais, p.impressora_id
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

    // Fire-and-forget: colunas opcionais (podem não existir ainda)
    pool.query(`
      ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS is_paid BOOLEAN;
      ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    `).then(() =>
      pool.query(`
        UPDATE dtf_pedidos
        SET is_paid = $2,
            paid_at = CASE WHEN $2 THEN NOW() ELSE NULL END
        WHERE id = $1
      `, [id, isPaid])
    ).catch(() => {})

    // Saída automática de film
    if (pedido.metros_finais && Number(pedido.metros_finais) > 0) {
      pool.query(`
        INSERT INTO dtf_insumo_saidas (insumo_id, impressora_id, quantidade, data, observacao)
        SELECT id, $1::int, $2::numeric, CURRENT_DATE, 'Auto: Pedido DTF #' || $3
        FROM dtf_insumos
        WHERE LOWER(grupo) = 'film'
        ORDER BY id LIMIT 1
      `, [pedido.impressora_id ?? null, pedido.metros_finais, pedido.number])
        .catch(() => {})
    }

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
