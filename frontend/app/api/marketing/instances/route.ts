import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getInstanceState } from "@/lib/whatsapp/evolutionInstances"

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_instances (
      id SERIAL PRIMARY KEY,
      instance_name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {})
}

// GET — lista todo número de marketing cadastrado, com o estado de conexão
// checado ao vivo na Evolution (não fica salvo, é sempre a foto de agora).
export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`
      SELECT id, instance_name AS "instanceName", label, active, created_at AS "createdAt"
      FROM marketing_instances
      ORDER BY created_at ASC
    `)
    const withState = await Promise.all(rows.map(async r => ({
      ...r,
      state: await getInstanceState(r.instanceName),
    })))
    return NextResponse.json(withState)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — cadastra um número já criado/vinculado no Evolution (não cria a
// instância lá, só passa a rastrear aqui pra entrar no rodízio de campanhas).
export async function POST(req: Request) {
  try {
    await ensureTable()
    const { instanceName, label } = await req.json() as { instanceName?: string; label?: string }
    if (!instanceName?.trim() || !label?.trim()) {
      return NextResponse.json({ error: "instanceName e label obrigatórios" }, { status: 400 })
    }

    const { rows } = await pool.query(`
      INSERT INTO marketing_instances (instance_name, label)
      VALUES ($1, $2)
      RETURNING id
    `, [instanceName.trim(), label.trim()])

    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isDup = msg.includes("duplicate key") || msg.includes("unique")
    return NextResponse.json({ error: isDup ? "Esse nome de instância já está cadastrado" : msg }, { status: isDup ? 400 : 500 })
  }
}
