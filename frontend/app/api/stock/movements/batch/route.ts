import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

type MovementInput = {
  variantId: string
  type: "in" | "out"
  quantity: number
  reason: string
  channel?: string
  notes?: string | null
  batchId?: string | null
}

export async function POST(req: Request) {
  const client = await pool.connect()
  try {
    const items: MovementInput[] = await req.json()

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Array de movimentos obrigatório" }, { status: 400 })
    }

    for (const item of items) {
      if (!item.variantId || !item.type || !item.quantity || !item.reason) {
        return NextResponse.json({ error: "variantId, type, quantity e reason são obrigatórios em cada item" }, { status: 400 })
      }
      if (!["in", "out"].includes(item.type)) {
        return NextResponse.json({ error: "type deve ser 'in' ou 'out'" }, { status: 400 })
      }
      if (Number(item.quantity) <= 0) {
        return NextResponse.json({ error: "quantity deve ser maior que 0" }, { status: 400 })
      }
    }

    await client.query("BEGIN")

    const rows = []
    for (const item of items) {
      const { rows: r } = await client.query(`
        INSERT INTO stock_movements (variant_id, type, quantity, reason, channel, notes, batch_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id, variant_id AS "variantId", type, quantity, reason, channel, notes,
          batch_id AS "batchId", created_at AS "createdAt"
      `, [
        item.variantId,
        item.type,
        Number(item.quantity),
        item.reason,
        item.channel ?? "manual",
        item.notes ?? null,
        item.batchId ?? null,
      ])
      rows.push(r[0])
    }

    await client.query("COMMIT")
    return NextResponse.json(rows, { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK")
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
