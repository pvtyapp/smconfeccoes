import { NextResponse } from "next/server"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Debug temporário: confere se a Evolution manda o base64 da mídia embutido
// no payload do webhook (isso pode estourar o limite de tamanho de request
// do Vercel pra arquivo grande, e a mensagem nunca chega na nossa rota).
export async function GET() {
  try {
    const res = await fetch(`${EVO_URL}/webhook/find/${EVO_INSTANCE}`, {
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return NextResponse.json({ ok: true, status: res.status, config: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
