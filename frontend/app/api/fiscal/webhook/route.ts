import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { processarResultadoNota } from "@/lib/fiscal/processarResultado"

// Focus NFe chama esse endpoint quando termina de processar uma nota
// (autorizada ou rejeitada) — configurado na aba Webhooks do Painel API.
// Formato do corpo é o mesmo do GET /v2/nfe/{ref} (testado manualmente em
// homologação antes de virar código).
//
// Na prática esse callback não chegou de forma confiável nos testes reais
// (nota já autorizada do lado da Focus NFe, nosso banco ficava
// "processando" por tempo indefinido) — por isso existe também a checagem
// ativa em /api/fiscal/notas/[id]/verificar, que não depende desse webhook
// chegar. Esse aqui continua no ar como caminho mais rápido quando funciona.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { ref } = body
    if (!ref) return NextResponse.json({ error: "ref ausente" }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT id, ambiente FROM fiscal_notes WHERE ref = $1`,
      [ref]
    )
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })

    await processarResultadoNota(note, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
