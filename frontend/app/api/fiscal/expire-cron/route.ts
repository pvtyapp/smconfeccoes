import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Rodado 1x/dia via cron-job.org (mesmo padrão de /api/orders/expire):
// POST /api/fiscal/expire-cron — Authorization: Bearer {CRON_SECRET}
//
// Zera só pdf/xml (os campos pesados, guardados em base64) de nota
// autorizada há mais de 7 dias — número, série, chave de acesso e protocolo
// continuam pra sempre. A nota já foi mandada por WhatsApp na hora que
// autorizou, então o site nunca foi a única cópia do arquivo.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { rows } = await pool.query(`
      UPDATE fiscal_notes
      SET pdf = NULL, xml = NULL
      WHERE status = 'autorizada'
        AND autorizado_em < NOW() - INTERVAL '7 days'
        AND (pdf IS NOT NULL OR xml IS NOT NULL)
      RETURNING id
    `)
    return NextResponse.json({ ok: true, expired: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
