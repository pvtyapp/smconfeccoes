import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ParsedItem = {
  productName: string
  color: string
  size: string
  qty: number
}

const SYSTEM = `Você é um assistente especializado em extrair itens de pedidos de confecção/vestuário a partir de texto livre em português.

Retorne APENAS um JSON válido no formato abaixo, sem texto extra:
[
  { "productName": "nome do produto", "color": "cor", "size": "tamanho", "qty": quantidade }
]

Regras:
- productName: nome do produto (ex: "moletom", "camiseta", "calça")
- color: cor em português (ex: "preto", "branco", "cinza")
- size: tamanho (P, M, G, GG, XG ou número como 34, 36...)
- qty: número inteiro de unidades
- Se não houver cor ou tamanho explícito, use "" (string vazia)
- Se a quantidade não estiver clara, use 1
- Agrupe itens distintos em entradas separadas
- Ignore texto que não seja pedido de produto`

export async function parseOrder(text: string, clientContext: string | null = null): Promise<ParsedItem[]> {
  const system = clientContext
    ? `${SYSTEM}\n\nContexto sobre este cliente: ${clientContext}`
    : SYSTEM
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: text }],
  })

  const raw = response.content[0].type === "text" ? response.content[0].text : ""

  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) {
    console.error("[parseOrder] AI response is not valid JSON:", raw.slice(0, 200))
    throw new Error("AI não retornou JSON válido")
  }

  const parsed = JSON.parse(match[0]) as ParsedItem[]
  return parsed.filter((i) => i.productName && i.qty > 0)
}
