import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// PATCH: (a) atualiza a ficha técnica de uma bobina de tecido ainda não usada
// em ordem concluída — usado pelo Editar de ordem em rascunho, pra completar
// tecido/peso/gramatura/etc sem perder o que já tinha sido digitado; ou
// (b) ajuste manual de status/notes (fluxo antigo de Outros insumos)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params
    const body = await req.json()
    const { status, notes, tecido, tipoTecido, pesoKg, gramatura, larguraM, precoKg } = body

    const hasFicha = [tecido, tipoTecido, pesoKg, gramatura, larguraM, precoKg].some(v => v !== undefined)
    if (hasFicha) {
      const { rows: cur } = await pool.query(`
        SELECT tecido, tipo_tecido AS "tipoTecido", peso_kg AS "pesoKg",
               gramatura, largura_m AS "larguraM", preco_kg AS "precoKg",
               total_pieces_produced AS "totalPiecesProduced"
        FROM raw_material_entries WHERE id=$1
      `, [id])
      if (!cur.length) return NextResponse.json({ error: "Bobina não encontrada" }, { status: 404 })
      if (Number(cur[0].totalPiecesProduced) > 0) {
        return NextResponse.json({ error: "Bobina já teve peças produzidas — ficha técnica não pode mudar" }, { status: 409 })
      }

      const m = {
        tecido:     tecido     !== undefined ? tecido     : cur[0].tecido,
        tipoTecido: tipoTecido !== undefined ? tipoTecido : cur[0].tipoTecido,
        pesoKg:     pesoKg     !== undefined ? Number(pesoKg)     : Number(cur[0].pesoKg)     || null,
        gramatura:  gramatura  !== undefined ? Number(gramatura)  : Number(cur[0].gramatura)  || null,
        larguraM:   larguraM   !== undefined ? Number(larguraM)   : Number(cur[0].larguraM)   || null,
        precoKg:    precoKg    !== undefined ? Number(precoKg)    : Number(cur[0].precoKg)    || null,
      }
      const complete = !!(m.tecido && m.tipoTecido && m.pesoKg && m.gramatura && m.larguraM && m.precoKg)
      let totalQty = 0, unitPrice = 0
      if (complete) {
        const larguraCorte = m.tipoTecido === "tubular" ? m.larguraM! * 2 : m.larguraM!
        totalQty = (m.pesoKg! * 1000) / (m.gramatura! * larguraCorte)
        unitPrice = (m.pesoKg! * m.precoKg!) / totalQty
      }

      const { rows } = await pool.query(`
        UPDATE raw_material_entries
        SET tecido=$1, tipo_tecido=$2, peso_kg=$3, gramatura=$4, largura_m=$5, preco_kg=$6,
            total_qty=$7, unit_price=$8
        WHERE id=$9
        RETURNING id, number
      `, [m.tecido ?? null, m.tipoTecido ?? null, m.pesoKg, m.gramatura, m.larguraM, m.precoKg, totalQty, unitPrice, id])
      if (!rows.length) return NextResponse.json({ error: "Bobina não encontrada" }, { status: 404 })
      return NextResponse.json({ entryId: rows[0].id, number: rows[0].number, totalQty, unitPrice })
    }

    // M2: prevent race condition — skip if already esgotada when trying to set esgotada
    const { rows } = await pool.query(`
      UPDATE raw_material_entries
      SET
        status = COALESCE($1, status),
        notes  = COALESCE($2, notes)
      WHERE id = $3
        AND NOT (COALESCE($1, '') = 'esgotada' AND status = 'esgotada')
      RETURNING id, number, status
    `, [status ?? null, notes ?? null, id])

    if (!rows.length) {
      const { rows: exists } = await pool.query(`SELECT id, status FROM raw_material_entries WHERE id=$1`, [id])
      if (!exists.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json(exists[0]) // already in target state
    }
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE: only if never used in a prod_order
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows: used } = await pool.query(
      "SELECT id FROM prod_order_materials WHERE entry_id=$1 LIMIT 1", [id]
    )
    if (used.length > 0) {
      return NextResponse.json(
        { error: "Lote já foi usado em uma ordem de produção e não pode ser excluído." },
        { status: 409 }
      )
    }
    await pool.query("DELETE FROM raw_material_entries WHERE id=$1", [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
