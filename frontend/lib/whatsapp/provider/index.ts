import { evolutionProvider } from "./evolutionProvider"
import type { WhatsAppProvider } from "./types"

export type { WhatsAppProvider } from "./types"
export * from "./types"

// Único provedor em uso: Evolution. Chegou a existir uma migração pra
// WPPConnect (Fase 1/2, jul/2026) que foi revertida — @lid quebrava na
// WPPConnect do mesmo jeito, e a conexão de verdade nunca saiu da Evolution.
// Mantido como função (não export direto) pra não precisar tocar nos ~16
// arquivos que já chamam getProvider() esperando uma Promise.
export async function getProvider(): Promise<WhatsAppProvider> {
  return evolutionProvider
}
