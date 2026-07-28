import { evolutionProvider } from "@/lib/whatsapp/provider/evolutionProvider"

export type InstanceState = "connected" | "disconnected"

// Status de qualquer instância comercial/principal na Evolution — usado só pra
// exibir status (painel de números, monitor), nunca decide envio por si só
// (quem decide envio é getProvider()/sendWhatsApp).
export async function getInstanceState(instanceName: string): Promise<InstanceState> {
  if (!instanceName) return "disconnected"
  const { state, ok } = await evolutionProvider.getConnectionState(instanceName, 6_000)
  if (!ok) return "disconnected"
  return state === "open" ? "connected" : "disconnected"
}
