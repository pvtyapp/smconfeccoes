import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `Você reescreve uma mensagem de WhatsApp de propaganda de uma confecção atacadista (também faz impressão DTF), gerando várias versões diferentes da mesma oferta.

Regras:
- NUNCA altere preço, endereço, tamanhos, datas ou qualquer dado numérico/factual — copie exatamente como está.
- Reescreva só as palavras ao redor (jeito de falar, ordem das frases, saudação) — mesma oferta, texto diferente.
- Mantenha o tom informal de loja de bairro, sem forçar gírias.
- Se o texto original tiver {nome}, mantenha o marcador {nome} literal em todas as versões (é substituído depois pelo nome do cliente).
- Cada versão deve ter tamanho parecido com o original — não invente informação nova, não corte informação que já estava lá.

Retorne APENAS um JSON válido: {"variants":["versão 1","versão 2",...]}, sem texto fora do JSON.`

export async function generateMarketingVariants(
  referenceText: string,
  count = 18
): Promise<string[]> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Texto original:\n"""${referenceText}"""\n\nGere ${count} versões reescritas, em JSON.`,
    }],
  })

  const raw = res.content[0].type === "text" ? res.content[0].text : ""
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("IA não retornou JSON válido")

  const parsed = JSON.parse(match[0]) as { variants?: unknown }
  const variants = Array.isArray(parsed.variants)
    ? parsed.variants.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : []

  if (variants.length === 0) throw new Error("IA não gerou variações válidas")
  return variants
}
