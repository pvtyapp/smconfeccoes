import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const { rows } = await pool.query(`
    SELECT DISTINCT
      fn.id, fn.numero, fn.serie, fn.chave_acesso AS "chaveAcesso", fn.protocolo,
      fn.valor_total AS "valorTotal", fn.autorizado_em AS "autorizadoEm",
      (fn.pdf IS NOT NULL) AS "pdfAvailable"
    FROM fiscal_notes fn
    JOIN fiscal_note_orders fno ON fno.fiscal_note_id = fn.id
    JOIN orders o ON o.id = fno.order_id
    WHERE o.contact_id = $1 AND fn.status = 'autorizada'
    ORDER BY fn.autorizado_em DESC
  `, [session.contactId])

  return NextResponse.json(rows)
}
