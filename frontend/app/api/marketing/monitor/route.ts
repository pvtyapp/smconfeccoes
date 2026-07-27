import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getInstanceState } from "@/lib/whatsapp/marketingInstances"

export async function GET() {
  try {
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS content_variants JSONB`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS pause_reason TEXT`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS instance_name TEXT`).catch(() => {})
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_instances (
        id SERIAL PRIMARY KEY,
        instance_name TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})

    // Toda campanha ativa agora (1 por número, quando o envio foi dividido)
    const { rows: campaigns } = await pool.query(`
      SELECT id, title, content, sent_count AS "sentCount", error_count AS "errorCount",
             total_count AS "totalCount", status, content_variants AS "contentVariants",
             pause_reason AS "pauseReason", paused_until AS "pausedUntil",
             instance_name AS "instanceName", created_at AS "createdAt"
      FROM marketing_campaigns
      WHERE status IN ('generating', 'sending')
      ORDER BY created_at DESC
    `)

    // Painel de números cadastrados, com estado ao vivo de cada um
    const { rows: registered } = await pool.query(`
      SELECT id, instance_name AS "instanceName", label, active
      FROM marketing_instances
      ORDER BY created_at ASC
    `)
    const instances = await Promise.all(registered.map(async r => ({
      ...r,
      state: await getInstanceState(r.instanceName),
    })))

    return NextResponse.json({ campaigns, instances })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
