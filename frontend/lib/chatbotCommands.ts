// Comandos do bot administrativo do WhatsApp — permissão própria, independente
// das abas liberadas no painel (allowed_pages). Um operador pode ter acesso ao
// comando "concluir ordem" pelo WhatsApp mesmo sem ver a aba Programação no
// painel, por exemplo. Usado tanto pela tela de Usuários (checkboxes) quanto
// pelo bot (lib/whatsapp/adminBot.ts, gate de cada comando).
export type ChatbotCommand = { key: string; label: string }

export const CHATBOT_COMMANDS: ChatbotCommand[] = [
  { key: "criar_ordem",    label: "Criar ordem de produção" },
  { key: "concluir_ordem", label: "Concluir ordem de produção" },
  { key: "vendas",         label: "Relatório de vendas" },
  { key: "financeiro",     label: "Relatório financeiro" },
  { key: "estoque",        label: "Relatório de estoque" },
  { key: "despesa",        label: "Lançar despesa variável" },
  { key: "receber",        label: "Clientes a receber" },
  { key: "contas_pagar",   label: "Lançar conta a pagar" },
]
