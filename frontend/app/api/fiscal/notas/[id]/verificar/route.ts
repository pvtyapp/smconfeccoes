import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { processarResultadoNota } from "@/lib/fiscal/processarResultado"

// Consulta ativa do status na Focus NFe — não depende do webhook deles
// chegar (na prática ele não chegou de forma confiável nos testes). Chamado
// pelo Relatório de Vendas enquanto tiver nota "processando" na tela.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { rows } = await pool.query(
      `SELECT id, ambiente, ref, status FROM fiscal_notes WHERE id = $1`,
      [id]
    )
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })
    if (note.status !== "processando") return NextResponse.json({ status: note.status })

    const { rows: settingsRows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key LIKE 'fiscal_%'`
    )
    const s: Record<string, string> = {}
    for (const r of settingsRows) s[r.key] = r.value
    const token = note.ambiente === "producao" ? s.fiscal_token_producao : s.fiscal_token_homologacao
    const baseUrl = note.ambiente === "producao"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br"

    const focusRes = await fetch(`${baseUrl}/v2/nfe/${encodeURIComponent(note.ref)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
    })
    const data = await focusRes.json().catch(() => ({}))

    if (data.status === "processando_autorizacao" || !data.status) {
      return NextResponse.json({ status: "processando" })
    }

    const result = await processarResultadoNota(note, data)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
