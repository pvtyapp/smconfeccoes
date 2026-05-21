import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type Intent = "pedido" | "preco" | "status" | "saudacao" | "outro"

const SYSTEM = `Você classifica mensagens de WhatsApp de clientes de uma confecção atacadista.
Retorne APENAS uma palavra (sem explicação):

pedido   — quer fazer um pedido de produtos
preco    — pergunta sobre preço, valor, disponibilidade, catálogo, tem tal produto?
status   — pergunta sobre status de um pedido existente
saudacao — cumprimento sem intenção clara (oi, bom dia, tudo bem)
outro    — qualquer outra coisa`

export async function classifyIntent(text: string): Promise<Intent> {
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    })
    const raw = (res.content[0].type === "text" ? res.content[0].text : "outro").trim().toLowerCase()
    const valid: Intent[] = ["pedido", "preco", "status", "saudacao", "outro"]
    return valid.includes(raw as Intent) ? (raw as Intent) : "outro"
  } catch {
    return "outro"
  }
}
