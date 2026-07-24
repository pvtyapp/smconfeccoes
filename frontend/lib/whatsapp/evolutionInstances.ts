const EVO_URL = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "")
const EVO_KEY = (process.env.EVOLUTION_API_KEY ?? "").trim()

export type InstanceState = "connected" | "disconnected"

// Mesma checagem que campaignSend faz antes de mandar — usada aqui só pra
// exibir status (painel de números, monitor), nunca decide envio por si só.
export async function getInstanceState(instanceName: string): Promise<InstanceState> {
  if (!EVO_URL || !EVO_KEY || !instanceName) return "disconnected"
  try {
    const res = await fetch(`${EVO_URL}/instance/connectionState/${instanceName}`, {
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
