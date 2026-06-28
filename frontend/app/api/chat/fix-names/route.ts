import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

const EVO_URL  = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "")
const EVO_KEY  = (process.env.EVOLUTION_API_KEY ?? "").trim()
const EVO_INST = (process.env.EVOLUTION_INSTANCE ?? "").trim()

async function fetchProfileName(jid: string): Promise<string | null> {
  try {
    const number = jid.replace("@s.whatsapp.net", "")
    const r = await fetch(`${EVO_URL}/chat/fetchProfile/${EVO_INST}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ number }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return null
    const d = await r.json()
    const name: string = d?.name ?? d?.pushName ?? d?.verifiedName ?? ""
    if (!name) return null
    const lower = name.toLowerCase().trim()
    if (lower === "você" || lower === "voce" || /^\d+$/.test(name)) return null
    return name
  } catch { return null }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get("dry") !== "false"

  const { rows: bad } = await pool.query(`
    SELECT id, jid, name, phone
    FROM wa_contacts
    WHERE LOWER(name) IN ('você', 'voce', 'you')
       OR name = phone
       OR name IS NULL
       OR name = ''
    ORDER BY id
  `)

  if (bad.length === 0) {
    return NextResponse.json({ ok: true, message: "Nenhum contato com nome inválido.", fixed: 0, dryRun })
  }

  const results: Array<{ id: number; jid: string; oldName: string; newName: string; source: string }> = []

  for (const c of bad) {
    const profileName = await fetchProfileName(c.jid as string)
    const newName = profileName ?? (c.phone as string)
    const source = profileName ? "evolution" : "phone_fallback"

    if (!dryRun && newName !== c.name) {
      await pool.query(
        `UPDATE wa_contacts SET name = $1, updated_at = NOW() WHERE id = $2`,
        [newName, c.id]
      )
    }

    results.push({ id: c.id, jid: c.jid, oldName: c.name, newName, source })
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    total: bad.length,
    fixed: dryRun ? 0 : results.length,
    contacts: results,
  })
}
