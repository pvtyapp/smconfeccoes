import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ParsedItem = {
  productName: string
  color: string
  size: string
  qty: number
}

const SYSTEM = `Você é um assistente especializado em extrair itens de pedidos de confecção/vestuário a partir de mensagens de WhatsApp em português.

Retorne APENAS um JSON válido no formato abaixo, sem texto extra:
[
  { "productName": "nome do produto", "color": "cor", "size": "tamanho", "qty": quantidade }
]

Regras de extração:
- productName: nome do produto em minúsculas (ex: "moletom", "camiseta", "calça")
- color: cor em português minúsculas (ex: "preto", "branco", "cinza mescla")
- size: tamanho em maiúsculas (P, M, G, GG, GGG ou número como 34, 36...)
- qty: número inteiro de unidades
- Se cor ou tamanho não estiver explícito, use "" (string vazia) — nunca invente
- Se a quantidade não estiver clara, use 1

Herança de produto (IMPORTANTE):
- Quando o produto é mencionado só uma vez e os itens seguintes não têm produto, herde o produto anterior
- Exemplos que devem gerar DOIS itens com o mesmo produto:
  "camiseta 10 preto P 20 cinza G" → [{camiseta,preto,P,10},{camiseta,cinza,G,20}]
  "10 camiseta preto P, 10 cinza G" → [{camiseta,preto,P,10},{camiseta,cinza,G,10}]
  "moletom: 5 preto P, 3 branco M" → [{moletom,preto,P,5},{moletom,branco,M,3}]
  "camiseta preto P 10, cinza G 5" → [{camiseta,preto,P,10},{camiseta,cinza,G,5}]

Formatos aceitos (todos equivalentes):
- "QTD produto cor tamanho" → ex: "20 moletom preto G"
- "produto QTD cor tamanho" → ex: "moletom 20 preto G"
- Vírgula separando itens → ex: "10 preto P, 5 cinza G"
- Quebra de linha separando itens
- Produto no início seguido de lista → ex: "camiseta: 10 preto P, 5 branco M"

Outros:
- Agrupe entradas distintas separadamente
- Ignore saudações, perguntas e texto que não seja pedido`

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
