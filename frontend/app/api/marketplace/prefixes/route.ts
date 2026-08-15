import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Prefixo do SKU → tipo de peça (texto livre, ex: "Moletom", "Camiseta
// Infantil"). NÃO é matching de produto/variante — só serve pra separar
// itens que têm cor+tamanho igual mas são peças diferentes na hora de
// agrupar a Lista de Separação (ver /api/marketplace/parse).
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id, prefix, tipo, created_at AS "createdAt"
      FROM marketplace_sku_prefixes ORDER BY created_at DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { prefix, tipo } = await req.json() as { prefix?: string; tipo?: string }
    if (!prefix?.trim() || !tipo?.trim()) {
      return NextResponse.json({ error: "prefix e tipo são obrigatórios" }, { status: 400 })
    }
    const cleanPrefix = prefix.trim().toUpperCase()
    const { rows } = await pool.query(`
      INSERT INTO marketplace_sku_prefixes (prefix, tipo)
      VALUES ($1, $2)
      ON CONFLICT (prefix) DO UPDATE SET tipo = EXCLUDED.tipo
      RETURNING id, prefix, tipo, created_at AS "createdAt"
    `, [cleanPrefix, tipo.trim()])
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
