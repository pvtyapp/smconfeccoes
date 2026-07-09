import { NextResponse } from "next/server"

const EVO_URL      = (process.env.EVOLUTION_API_URL  ?? "").trim().replace(/\/+$/, "")
const EVO_KEY      = (process.env.EVOLUTION_API_KEY  ?? "").trim()
const EVO_INSTANCE = (process.env.EVOLUTION_INSTANCE ?? "").trim()

// Debug temporário: pergunta direto pra Evolution (não pro nosso banco) se ela
// própria tem o arquivo de 41MB na história de mensagens do MLV — confirma se
// o problema é a Evolution nunca ter processado o arquivo, ou se ela processou
// mas não avisou a gente via webhook.
export async function GET() {
  try {
    const jid = "5516999653885@s.whatsapp.net"
    const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, skip: 0, limit: 200 }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    const records = (data?.messages?.records ?? data?.records ?? (Array.isArray(data) ? data : [])) as Record<string, unknown>[]
    const incoming = records.filter(r => (r.key as Record<string, unknown> | undefined)?.fromMe === false)
    const summary = records.map(r => {
      const key = r.key as Record<string, unknown> | undefined
      const msg = r.message as Record<string, unknown> | undefined
      const inner = (msg?.documentMessage ?? msg?.imageMessage ?? msg?.videoMessage) as Record<string, unknown> | undefined
      return {
        id: key?.id,
        fromMe: key?.fromMe,
        messageTimestamp: r.messageTimestamp,
        type: r.messageType,
        content: (msg?.conversation as string) ?? null,
        fileLength: inner?.fileLength,
        fileName: inner?.fileName,
        mimetype: inner?.mimetype,
      }
    })
    return NextResponse.json({
      ok: true, status: res.status, totalRecords: records.length,
      incomingCount: incoming.length, summary,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
