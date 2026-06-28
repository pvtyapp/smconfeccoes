import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// POST /api/prod-orders/[id]/revision
// body: {
//   grade: { color, size, qty, aprovadas, avarias }[]
// }
// → defect_stock records for avarias
// → stock_movements for aprovadas (if variant exists)
// → prod_order status = 'encerrada'
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }  = await params
    const { grade } = await req.json()

    if (!grade?.length) {
      return NextResponse.json({ error: "grade é obrigatório" }, { status: 400 })
    }

    // Get order info
    const { rows: orders } = await pool.query(
      `SELECT product_id AS "productId", product_name AS "productName" FROM prod_orders WHERE id=$1`,
      [id]
    )
    if (!orders.length) return NextResponse.json({ error: "Ordem não encontrada" }, { status: 404 })
    const { productId, productName } = orders[0]

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      for (const g of grade) {
        const aprovadas = g.aprovadas ?? 0
        const avarias   = g.avarias   ?? 0

        // Defect stock for avarias
        if (avarias > 0) {
          // Try to find variant
          const { rows: vRows } = await client.query(`
            SELECT id FROM product_variants
            WHERE product_id=$1 AND color=$2 AND size=$3 AND status='active'
            LIMIT 1
          `, [productId, g.color, g.size])

          await client.query(`
            INSERT INTO defect_stock
              (variant_id, product_name, color, size, qty, order_id, disposition)
            VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
          `, [vRows[0]?.id ?? null, productName, g.color, g.size, avarias, id])
        }

        // Stock movement for aprovadas
        if (aprovadas > 0) {
          const { rows: vRows } = await client.query(`
            SELECT id FROM product_variants
            WHERE product_id=$1 AND color=$2 AND size=$3 AND status='active'
            LIMIT 1
          `, [productId, g.color, g.size])

          if (vRows.length) {
            await client.query(`
              INSERT INTO stock_movements
                (variant_id, type, quantity, reason, channel)
              VALUES ($1, 'in', $2, 'producao', 'producao')
            `, [vRows[0].id, aprovadas])
          }
        }
      }

      // Create revision batch records per color
      const colorMap = new Map<string, { total: number; approved: number; defect: number }>()
      for (const g of grade) {
        const cur = colorMap.get(g.color) ?? { total: 0, approved: 0, defect: 0 }
        cur.total    += g.qty       ?? 0
        cur.approved += g.aprovadas ?? 0
        cur.defect   += g.avarias   ?? 0
        colorMap.set(g.color, cur)
      }
      for (const [color, vals] of colorMap) {
        await client.query(`
          INSERT INTO prod_revision_batches
            (order_id, color, qty_total, qty_approved, qty_defect, status, concluded_at)
          VALUES ($1, $2, $3, $4, $5, 'concluido', NOW())
          ON CONFLICT DO NOTHING
        `, [id, color, vals.total, vals.approved, vals.defect])
      }

      // Mark order as encerrada
      await client.query(
        `UPDATE prod_orders SET status='encerrada' WHERE id=$1`, [id]
      )

      await client.query("COMMIT")

      // ── Notifica reservas pendentes — FIFO por variante (só o 1º de cada fila) ──
      const approvedVariantIds = grade
        .filter((g: { aprovadas?: number }) => (g.aprovadas ?? 0) > 0)
        .map((g: { color: string; size: string }) => `${g.color}|||${g.size}`)

      if (approvedVariantIds.length > 0) {
        // Busca todas as reservas pendentes desta prod_order, ordenadas por variante + criação
        const { rows: allReservations } = await pool.query(`
          SELECT pr.id, pr.contact_id, pr.variant_id, pr.qty,
                 pv.color, pv.size, p.name AS product_name,
                 c.jid, c.name AS contact_name
          FROM product_reservations pr
          JOIN product_variants pv ON pv.id = pr.variant_id
          JOIN products p          ON p.id  = pv.product_id
          JOIN wa_contacts c       ON c.id  = pr.contact_id
          WHERE pr.status = 'pending'
            AND pr.prod_order_id = $1
          ORDER BY pr.variant_id, pr.created_at ASC
        `, [id])

        // FIFO por variante: só notifica o PRIMEIRO de cada fila
        const firstPerVariant = new Map<string, typeof allReservations[0]>()
        for (const res of allReservations) {
          const key = String(res.variant_id)
          if (!firstPerVariant.has(key)) firstPerVariant.set(key, res)
        }

        const { rows: cfg } = await pool.query(
          `SELECT value FROM app_settings WHERE key = 'reserva_expiry_hours'`
        )
        const expiryHours = Number(cfg[0]?.value ?? 4)

        for (const res of firstPerVariant.values()) {
          if (!res.jid) continue
          const variantName = [res.product_name, res.color, res.size].filter(Boolean).join(" ")
          const expiresAt   = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()

          await pool.query(`
            UPDATE product_reservations
            SET status = 'notified', notified_at = NOW(), expires_at = $1
            WHERE id = $2
          `, [expiresAt, res.id])

          await pool.query(`
            UPDATE wa_contacts SET state = 'aguardando_reserva_resposta',
              state_data = $1, updated_at = NOW()
            WHERE id = $2
          `, [JSON.stringify({
            reservationId: res.id,
            variantId:     res.variant_id,
            variantName,
            qty:           res.qty,
          }), res.contact_id])

          sendWhatsApp(
            res.jid,
            `🎉 Boa notícia! A *${variantName}* que você reservou chegou!\n\nAinda precisa? Responde *SIM* ou *NÃO*.`
          ).catch(() => {})
        }
      }

      return NextResponse.json({ success: true })
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
