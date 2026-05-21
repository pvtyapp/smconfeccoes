const EVO_URL = process.env.EVOLUTION_API_URL!
const EVO_KEY = process.env.EVOLUTION_API_KEY!
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE!

export async function sendWhatsApp(jid: string, text: string) {
  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVO_KEY,
    },
    body: JSON.stringify({
      number: jid,
      text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Evolution API error ${res.status}: ${err}`)
  }

  return res.json()
}
