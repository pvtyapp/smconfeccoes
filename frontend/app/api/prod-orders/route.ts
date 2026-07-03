import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// ─── GET: list all prod_orders with grade + materials ──────────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") // comma-separated

    const statusList = status ? status.split(",") : null

    const { rows: orders } = await pool.query(`
      SELECT
        po.id, po.number, po.product_id AS "productId", po.product_name AS "productName",
        po.status, po.cost_status AS "costStatus",
        po.unit_cost AS "unitCost", po.total_cost AS "totalCost",
        po.created_at AS "createdAt", po.concluded_at AS "concludedAt"
      FROM prod_orders po
      WHERE ($1::text[] IS NULL OR po.status = ANY($1))
      ORDER BY po.created_at DESC
    `, [statusList])

    if (!orders.length) return NextResponse.json([])

    const ids = orders.map(o => o.id)

    // Grade items
    const { rows: items } = await pool.query(`
      SELECT order_id AS "orderId", color, size, qty_produced AS "qtyProduced"
      FROM prod_order_items
      WHERE order_id = ANY($1)
      ORDER BY color, size
    `, [ids])

    // Materials (with color — fallback to empty string if column doesn't exist yet)
    const { rows: mats } = await pool.query(`
      SELECT
        pom.order_id AS "orderId",
        pom.entry_id AS "entryId",
        rme.number AS "entryNumber",
        rme.material_id AS "materialId", rm.name AS "materialName", rm.unit,
        rme.total_qty AS "totalQty", rme.total_cost AS "totalCost",
        pom.pieces_from_entry AS "piecesFromEntry",
        pom.exhausted_here AS "exhaustedHere",
        rme.status AS "entryStatus",
        COALESCE(pom.color, '') AS "color"
      FROM prod_order_materials pom
      JOIN raw_material_entries rme ON rme.id = pom.entry_id
      JOIN raw_materials rm ON rm.id = rme.material_id
      WHERE pom.order_id = ANY($1)
    `, [ids]).catch(() => pool.query(`
      SELECT
        pom.order_id AS "orderId",
        pom.entry_id AS "entryId",
        rme.number AS "entryNumber",
        rme.material_id AS "materialId", rm.name AS "materialName", rm.unit,
        rme.total_qty AS "totalQty", rme.total_cost AS "totalCost",
        pom.pieces_from_entry AS "piecesFromEntry",
        pom.exhausted_here AS "exhaustedHere",
        rme.status AS "entryStatus",
        '' AS "color"
      FROM prod_order_materials pom
      JOIN raw_material_entries rme ON rme.id = pom.entry_id
      JOIN raw_materials rm ON rm.id = rme.material_id
      WHERE pom.order_id = ANY($1)
    `, [ids]))

    // Revision batch totals
    const { rows: revisions } = await pool.query(`
      SELECT
        order_id AS "orderId",
        SUM(qty_approved) AS "totalAprovadas",
        SUM(qty_defect)   AS "totalAvarias"
      FROM prod_revision_batches
      WHERE order_id = ANY($1)
      GROUP BY order_id
    `, [ids])

    const revMap = new Map(revisions.map(r => [r.orderId, r]))

    // Order logs (silent fallback to [] if table doesn't exist yet)
    const logMap = new Map<number, { at: string; text: string }[]>()
    await pool.query(`
      SELECT order_id AS "orderId", event, payload, created_at AS "createdAt"
      FROM prod_order_logs
      WHERE order_id = ANY($1)
      ORDER BY created_at ASC
    `, [ids]).then(({ rows: logs }) => {
      for (const log of logs) {
        if (!logMap.has(log.orderId)) logMap.set(log.orderId, [])
        logMap.get(log.orderId)!.push({
          at:   new Date(log.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
          text: log.event,
        })
      }
    }).catch(() => {})

    const result = orders.map(o => ({
      ...o,
      grade:          items.filter(i => i.orderId === o.id).map(({ orderId: _, ...r }) => r),
      materials:      mats.filter(m => m.orderId === o.id).map(({ orderId: _, ...r }) => r),
      totalAprovadas: Number(revMap.get(o.id)?.totalAprovadas ?? 0),
      totalAvarias:   Number(revMap.get(o.id)?.totalAvarias   ?? 0),
      logs:           logMap.get(o.id) ?? [],
    }))

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST: create prod_order ───────────────────────────────────────────────────
// body: { productId, selectedColors, entries: [{entryId, color}][] }
// (also supports legacy: entryIds: number[] — maps to entries without color)
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { productId, selectedColors } = body

    // Support both entries:[{entryId, color}] and legacy entryIds:number[]
    const entries: { entryId: number; color?: string }[] =
      body.entries ?? (body.entryIds ?? []).map((id: number) => ({ entryId: id }))

    if (!productId || !selectedColors?.length) {
      return NextResponse.json(
        { error: "productId e selectedColors são obrigatórios" },
        { status: 400 }
      )
    }

    // Fetch product to get sizes + name
    const { rows: prods } = await pool.query(
      `SELECT name, COALESCE(size_list,'{}') AS sizes FROM products WHERE id=$1`,
      [productId]
    )
    if (!prods.length) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 })
    }
    const { name: productName, sizes } = prods[0]

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // C3: Validate that all selected entries are not already esgotada
      for (const entry of entries) {
        const { rows: entryRows } = await client.query(
          `SELECT status FROM raw_material_entries WHERE id = $1`,
          [entry.entryId]
        )
        if (!entryRows.length) {
          throw new Error(`Lote ${entry.entryId} não encontrado`)
        }
        if (entryRows[0].status === 'esgotada') {
          throw new Error(`Lote ${entry.entryId} já está esgotado e não pode ser usado`)
        }
      }

      // Create order
      const { rows } = await client.query(`
        INSERT INTO prod_orders (product_id, product_name, number, status)
        VALUES ($1, $2, 'OP-TEMP', 'em_andamento')
        RETURNING id, created_at AS "createdAt"
      `, [productId, productName])

      const { id, createdAt } = rows[0]
      const number = `OP-${String(id).padStart(4, "0")}`
      await client.query("UPDATE prod_orders SET number=$1 WHERE id=$2", [number, id])

      // Create grade items: selectedColors × product.sizes
      for (const color of selectedColors) {
        for (const size of sizes) {
          await client.query(`
            INSERT INTO prod_order_items (order_id, product_name, color, size, qty_planned)
            VALUES ($1, $2, $3, $4, 0)
          `, [id, productName, color, size])
        }
      }

      // Link material entries (with color — graceful fallback if column doesn't exist)
      for (const entry of entries) {
        const inserted = await client.query(
          `INSERT INTO prod_order_materials (order_id, entry_id, color) VALUES ($1, $2, $3)`,
          [id, entry.entryId, entry.color ?? null]
        ).catch(() =>
          client.query(
            `INSERT INTO prod_order_materials (order_id, entry_id) VALUES ($1, $2)`,
            [id, entry.entryId]
          )
        )
        void inserted
      }

      await client.query("COMMIT")

      // Log event (silent fail if table doesn't exist yet)
      pool.query(
        `INSERT INTO prod_order_logs (order_id, event, payload) VALUES ($1, $2, $3)`,
        [id, 'criada', JSON.stringify({ productId, productName, selectedColors, entryCount: entries.length })]
      ).catch(() => {})

      return NextResponse.json({ id, number, createdAt }, { status: 201 })
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
