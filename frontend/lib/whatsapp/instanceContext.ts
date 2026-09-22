import { AsyncLocalStorage } from "node:async_hooks"

// Propaga qual instância Evolution recebeu a mensagem através de toda a cadeia de
// chamadas do webhook (handleGroupMessage/handleAdminMessage/adminBot.reply()) sem
// precisar passar um parâmetro extra pelas ~70 chamadas de reply() já existentes.
// Sem isso, sendWhatsApp() sempre mandava pela instância principal (EVOLUTION_INSTANCE),
// mesmo quando a mensagem recebida veio da instância dedicada "sm-admin" — a resposta
// saía por um número que não participa do grupo/DM administrativo e nunca chegava.
const storage = new AsyncLocalStorage<string>()

export function withInstance<T>(instanceName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(instanceName, fn)
}

export function getCurrentInstance(): string | undefined {
  return storage.getStore()
}
