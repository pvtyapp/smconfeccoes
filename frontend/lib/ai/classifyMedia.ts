import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type MediaType = "pix" | "dtf" | "outro"

export async function classifyMedia(
  base64: string,
  mimeType: string,
  conversationContext?: string
): Promise<MediaType> {
  try {
    // PDFs and non-image documents without context — use context alone
    const isImage = mimeType.startsWith("image/")

    const contextHint = conversationContext
      ? `\n\nContexto da conversa: "${conversationContext}"`
      : ""

    const messages: Anthropic.MessageParam[] = []

    if (isImage) {
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64,
            },
          },
          {
            type: "text",
            text: `O que é este arquivo? Retorne APENAS uma palavra:
pix   — comprovante de pagamento PIX ou transferência bancária
dtf   — arquivo de impressão DTF (design gráfico, arte para estampar)
outro — qualquer outra coisa${contextHint}`,
          },
        ],
      })
    } else {
      // Document — rely on context
      messages.push({
        role: "user",
        content: `Um cliente enviou um documento (${mimeType}).${contextHint}
Baseado no contexto, este documento é mais provavelmente:
pix   — comprovante de pagamento
dtf   — arquivo de arte/impressão DTF
outro — outro tipo
Retorne APENAS uma palavra.`,
      })
    }

    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      system: "Você analisa arquivos enviados por clientes de uma confecção.",
      messages,
    })

    const raw = (res.content[0].type === "text" ? res.content[0].text : "outro").trim().toLowerCase()
    const valid: MediaType[] = ["pix", "dtf", "outro"]
    return valid.includes(raw as MediaType) ? (raw as MediaType) : "outro"
  } catch {
    return "outro"
  }
}
