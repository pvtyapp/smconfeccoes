import { wppconnectProvider } from "@/lib/whatsapp/provider/wppconnectProvider"

export type InstanceState = "connected" | "disconnected"

// Status de qualquer instância comercial/principal — todas vivem no WPPConnect
// agora (Evolution não entra mais na gestão de conexão, só ainda manda/recebe
// mensagem de cliente real até a Fase 3/4 reescrever esse lado).
export async function getInstanceState(instanceName: string): Promise<InstanceState> {
  if (!instanceName) return "disconnected"
  const { state, ok } = await wppconnectProvider.getConnectionState(instanceName, 6_000)
  if (!ok) return "disconnected"
  return state === "open" ? "connected" : "disconnected"
}
