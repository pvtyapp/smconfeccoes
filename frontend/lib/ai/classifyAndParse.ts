import Anthropic from "@anthropic-ai/sdk"
import type { Intent } from "./classifyIntent"
import type { ParsedItem } from "./parseOrder"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ClassifyAndParseResult = {
  intent: Intent
  items: ParsedItem[]
}

const SYSTEM = `Você analisa mensagens de WhatsApp de clientes de uma confecção atacadista (também faz impressão DTF).

Retorne APENAS um JSON válido no formato abaixo, sem texto extra:
{"intent":"<intent>","items":[...]}

Valores de intent:
- pedido   — quer fazer pedido de roupas/produtos (moletom, camiseta, bermuda, etc.)
- dtf      — pedido ou dúvida sobre impressão DTF (menciona metro, arte, PNG, arquivo, imprimir, DTF)
- preco    — pergunta sobre preço, valor, tabela ou catálogo (sem ser DTF e sem perguntar sobre cores/tamanhos)
- variacao — pergunta sobre cores, tamanhos ou variações disponíveis (que cor tem? que tamanho? tem em preto? tem P?)
- status   — pergunta sobre status de pedido existente
- saudacao — cumprimento sem intenção clara (oi, bom dia, tudo bem)
- outro    — qualquer outra coisa

Campo items (apenas quando intent = "pedido"):
[{"productName":"nome","color":"cor","size":"tamanho","qty":quantidade}]

Regras de items:
- productName: nome do produto (ex: "moletom", "camiseta")
- color: cor em português (ex: "preto", "branco") — "" se não informado
- size: P, M, G, GG, XG ou número (ex: 34, 36) — "" se não informado
- qty: número inteiro de unidades — 1 se não claro
- Para intent ≠ "pedido": items deve ser []

Exemplos:
{"intent":"pedido","items":[{"productName":"moletom","color":"preto","size":"P","qty":20}]}
{"intent":"variacao","items":[]}
{"intent":"preco","items":[]}
{"intent":"saudacao","items":[]}`

export async function classifyAndParse(
  text: string,
  chatbotObs: string | null = null
): Promise<ClassifyAndParseResult> {
  const system = chatbotObs ? `${SYSTEM}\n\nContexto sobre este cliente: ${chatbotObs}` : SYSTEM

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: text }],
  })

  const raw = res.content[0].type === "text" ? res.content[0].text : ""
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("AI não retornou JSON válido")

  const parsed = JSON.parse(match[0]) as { intent: string; items: ParsedItem[] }
  const valid: Intent[] = ["pedido", "dtf", "preco", "variacao", "status", "saudacao", "outro"]
  const intent: Intent = valid.includes(parsed.intent as Intent) ? (parsed.intent as Intent) : "outro"
  const items: ParsedItem[] = Array.isArray(parsed.items)
    ? parsed.items.filter(i => i.productName && i.qty > 0)
    : []

  return { intent, items }
}
