import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { isNfeEligible } from "@/lib/portal/fiscalCompleteness"
import { emitirNotaFiscal } from "@/lib/fiscal/emitirNota"

export async function POST(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { orderIds } = await req.json() as { orderIds: number[] }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "Selecione pelo menos um pedido" }, { status: 400 })
    }

    const { rows: contactRows } = await pool.query(
      `SELECT tipo_pessoa AS "tipoPessoa", regime_tributario AS "regimeTributario" FROM wa_contacts WHERE id = $1`,
      [session.contactId]
    )
    if (!isNfeEligible(contactRows[0] ?? {})) {
      return NextResponse.json({ error: "Emissão de nota fiscal não disponível para pessoa física ou MEI." }, { status: 400 })
    }

    // Confirma que todo pedido selecionado é mesmo do cliente logado — nunca
    // confia no que veio do body além do id.
    const { rows: ownedOrders } = await pool.query(
      `SELECT id FROM orders WHERE id = ANY($1::int[]) AND contact_id = $2`,
      [orderIds, session.contactId]
    )
    if (ownedOrders.length !== orderIds.length) {
      return NextResponse.json({ error: "Um ou mais pedidos não pertencem à sua conta." }, { status: 403 })
    }

    const result = await emitirNotaFiscal(orderIds)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
