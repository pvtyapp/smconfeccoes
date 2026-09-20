import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { evolutionProvider } from "@/lib/whatsapp/provider/evolutionProvider"

const ADMIN_INSTANCE_NAME = "sm-admin"

async function getStoredName(): Promise<string | null> {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'admin_instance_name'`).catch(() => ({ rows: [] as { value: string }[] }))
  return rows[0]?.value ?? null
}

// Instância híbrida (plano "Grupo Admin Dedicado", 2026-09-20): atende o
// grupo dos administradores (bot só fala com "menu") E aceita DM 1:1 direto
// nela, igual o principal já faz — mesmo número, dois jeitos de usar.
export async function GET() {
  const name = await getStoredName()
  if (!name) {
    return NextResponse.json({ created: false, instanceName: null, state: null, connected: false })
  }
  const { state, ok } = await evolutionProvider.getConnectionState(name, 8_000)
  return NextResponse.json({ created: true, instanceName: name, state: ok ? state : null, connected: state === "open" })
}

// POST — na primeira vez, cria a instância de verdade na Evolution (fica
// esperando o QR ser escaneado, sem prazo — o chip físico pode demorar a
// chegar). Nas próximas, só pede um QR novo pra (re)conectar.
export async function POST() {
  try {
    let name = await getStoredName()
    if (!name) {
      name = ADMIN_INSTANCE_NAME
      const created = await evolutionProvider.createInstance(name)
      if (!created.ok) {
        return NextResponse.json({ error: "Não foi possível criar a instância admin na Evolution" }, { status: 502 })
      }
      await pool.query(
        `INSERT INTO app_settings (key, value) VALUES ('admin_instance_name', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [name]
      )
      return NextResponse.json({ instanceName: name, qrcodeBase64: created.qrcodeBase64 })
    }
    const { base64 } = await evolutionProvider.getQrCode(name)
    return NextResponse.json({ instanceName: name, qrcodeBase64: base64 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
