import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL     = (process.env.EVOLUTION_API_URL           ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY            ?? "").trim()
const EVO_INST_MKT = (process.env.EVOLUTION_INSTANCE_MARKETING ?? "").trim()

// Estado da instância de marketing (a mesma checagem que campaignSend faz antes
// de cada envio) — usado só pra mostrar no card, não pra decidir se manda ou não.
async function getMarketingInstanceState(): Promise<"connected" | "disconnected" | "not_configured"> {
  if (!EVO_URL || !EVO_KEY || !EVO_INST_MKT) return "not_configured"
  try {
    const res = await fetch(`${EVO_URL}/instance/connectionState/${EVO_INST_MKT}`, {
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return "disconnected"
    const data = await res.json() as { instance?: { state?: string }; state?: string }
    const state = data?.instance?.state ?? data?.state
    return state === "open" ? "connected" : "disconnected"
  } catch {
    return "disconnected"
  }
}

export async function GET() {
  try {
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS content_variants JSONB`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`).catch(() => {})
    await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS pause_reason TEXT`).catch(() => {})

    const { rows } = await pool.query(`
      SELECT id, title, content, sent_count AS "sentCount", error_count AS "errorCount",
             total_count AS "totalCount", status, content_variants AS "contentVariants",
             pause_reason AS "pauseReason", paused_until AS "pausedUntil", created_at AS "createdAt"
      FROM marketing_campaigns
      WHERE status IN ('generating', 'sending')
      ORDER BY created_at DESC
      LIMIT 1
    `)

    const campaign = rows[0] ?? null
    const instanceState = await getMarketingInstanceState()

    return NextResponse.json({ campaign, instanceState })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
