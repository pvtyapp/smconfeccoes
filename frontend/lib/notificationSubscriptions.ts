// Avisos automáticos que o bot manda por WhatsApp sem o operador pedir nada —
// diferente de chatbot_commands (comandos que ele digita pro bot), isso é
// assinatura: "me avisa quando X acontecer". Independente de aba do painel e
// de comando do bot — um operador pode só receber aviso, sem usar comando
// nenhum, ou vice-versa.
export type NotificationSubscription = { key: string; label: string }

export const NOTIFICATION_SUBSCRIPTIONS: NotificationSubscription[] = [
  { key: "costura_revisao", label: "Ordem de produção pronta pra revisão" },
]
