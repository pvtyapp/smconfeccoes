import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type Intent = "pedido" | "dtf" | "preco" | "variacao" | "status" | "remover" | "alterar" | "saudacao" | "outro"

const SYSTEM = `Você classifica mensagens de WhatsApp de clientes de uma confecção atacadista que também faz impressão DTF.
Retorne APENAS uma palavra (sem explicação):

pedido   — quer fazer um pedido de roupas/produtos (moletom, camiseta, bermuda, etc.)
dtf      — pedido ou dúvida sobre impressão DTF: menciona metro, metragem, largura, folha, arte, arquivo, PNG, imprimir, DTF
preco    — pergunta sobre preço, valor, tabela ou catálogo (sem ser DTF e sem perguntar sobre cores/tamanhos)
variacao — pergunta sobre cores, tamanhos ou variações disponíveis (que cor tem? que tamanho? tem em preto? tem P?)
status   — pergunta sobre status de um pedido existente
remover  — quer tirar ou cancelar um item específico do pedido (tira o moletom, remove o item 2, não quero mais a camiseta)
alterar  — quer mudar quantidade, cor ou tamanho de um item já pedido (muda pra 10, ao invés de preto quero azul, troca o P por M)
saudacao — cumprimento sem intenção clara (oi, bom dia, tudo bem)
outro    — qualquer outra coisa`

export async function classifyIntent(text: string, clientContext: string | null = null): Promise<Intent> {
  try {
    const system = clientContext
      ? `${SYSTEM}\n\nContexto sobre este cliente: ${clientContext}`
      : SYSTEM
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      system,
      messages: [{ role: "user", content: text }],
    })
    const raw = (res.content[0].type === "text" ? res.content[0].text : "outro").trim().toLowerCase()
    const valid: Intent[] = ["pedido", "dtf", "preco", "variacao", "status", "remover", "alterar", "saudacao", "outro"]
    return valid.includes(raw as Intent) ? (raw as Intent) : "outro"
  } catch {
    return "outro"
  }
}
