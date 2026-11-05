import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { garantirColunaCarrinho } from "@/lib/portal/pedidoSite"

export async function GET() {
  try {
    await garantirColunaCarrinho()
    const { rows } = await pool.query(`
      SELECT id, name, phone, sales_channels AS "salesChannels", carrinho,
             status, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt", created_at AS "createdAt"
      FROM fornecedor_solicitacoes
      ORDER BY (status = 'pendente') DESC, created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
