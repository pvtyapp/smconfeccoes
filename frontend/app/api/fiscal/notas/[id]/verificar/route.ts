import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { verificarNota } from "@/lib/fiscal/verificarNota"

// Consulta ativa do status na Focus NFe — não depende do webhook deles
// chegar (na prática ele não chegou de forma confiável nos testes). Chamado
// pelo Relatório de Vendas enquanto tiver nota "processando" na tela; o mesmo
// trabalho roda sozinho depois da emissão e no cron /api/fiscal/verificar-cron.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const r = await verificarNota(Number(id))
    if (r === "nao_encontrada") return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })
    const { rows } = await pool.query(`SELECT status FROM fiscal_notes WHERE id = $1`, [id])
    return NextResponse.json({ status: rows[0]?.status ?? r })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
