import { NextResponse } from "next/server"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Debug temporário, uso único: desliga webhookBase64 (Evolution parava de mandar
// mídia grande embutida no payload do webhook, estourando o limite de tamanho de
// request do Vercel e derrubando a mensagem inteira sem deixar rastro).
export async function POST() {
  try {
    const res = await fetch(`${EVO_URL}/webhook/set/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        webhook: {
          url: "https://smconfeccoes.vercel.app/api/whatsapp/webhook",
          enabled: true,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CHATS_UPSERT", "GROUPS_UPSERT", "CONTACTS_UPSERT", "CONNECTION_UPDATE"],
          webhookByEvents: false,
          webhookBase64: false,
        },
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return NextResponse.json({ ok: true, status: res.status, result: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
