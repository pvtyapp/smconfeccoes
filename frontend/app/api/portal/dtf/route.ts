import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

// DTF do cliente logado, pro card "DTF · 30 dias" do portal (PIV 06/11):
// mesma ideia do gráfico de peças, contando METROS. Metro final (o que saiu
// impresso) tem preferência sobre o pedido; cancelado não vem.
export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { rows } = await pool.query(`
      SELECT id, status,
             (data::text || 'T12:00:00') AS "createdAt",
             COALESCE(metros_finais, metros, 0)::float AS metros,
             COALESCE(preco_cobrado, 0)::float AS valor
      FROM dtf_pedidos
      WHERE contact_id = $1 AND status <> 'cancelado'
      ORDER BY data DESC, id DESC
      LIMIT 1000
    `, [session.contactId])
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
