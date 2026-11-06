import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getProvider, type Presence } from "@/lib/whatsapp/provider"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { garantirColunasChat } from "@/lib/whatsapp/colunasChat"

export const dynamic = "force-dynamic"

// Ferramentas do WhatsApp no chat do Autoatendimento (PIV 05/11): reagir, editar,
// encaminhar e "digitando…". Uma rota só pra não espalhar quatro arquivos iguais.
//   reagir      { acao, messageDbId, emoji }          emoji "" tira a reação
//   editar      { acao, messageDbId, texto }          só mensagem nossa de texto, até 15 min
//   encaminhar  { acao, messageDbId, paraContactId }
//   digitando   { acao, jid, estado }                 composing | recording | paused

// Mesmo critério do sendWhatsApp: @lid vai inteiro, o resto só os dígitos
function numeroDe(jid: string) {
  return jid.endsWith("@lid") ? jid : jid.replace("@s.whatsapp.net", "").replace("@g.us", "").replace(/:[0-9]+$/, "")
}

type Linha = {
  id: number; message_id: string | null; direction: "in" | "out"; content: string | null
  media_type: string | null; media_data: string | null; media_url: string | null
  file_name: string | null; caption: string | null; created_at: string
  jid: string; contact_id: number
}

async function mensagem(id: number): Promise<Linha | null> {
  const { rows } = await pool.query<Linha>(
    `SELECT m.id, m.message_id, m.direction, m.content, m.media_type, m.media_data, m.media_url,
            m.file_name, m.caption, m.created_at, c.jid, m.contact_id
       FROM wa_messages m JOIN wa_contacts c ON c.id = m.contact_id
      WHERE m.id = $1`, [id])
  return rows[0] ?? null
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      acao: "reagir" | "editar" | "encaminhar" | "digitando"
      messageDbId?: number; emoji?: string; texto?: string; paraContactId?: number
      jid?: string; estado?: Presence
    }
    const provider = await getProvider()

    if (body.acao === "digitando") {
      if (!body.jid) return NextResponse.json({ error: "jid obrigatório" }, { status: 400 })
      await provider.sendPresence(numeroDe(body.jid), body.estado ?? "composing")
      return NextResponse.json({ ok: true })
    }

    await garantirColunasChat()
    const m = body.messageDbId ? await mensagem(body.messageDbId) : null
    if (!m) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 })

    if (body.acao === "reagir") {
      if (!m.message_id) return NextResponse.json({ error: "Essa mensagem ainda não tem id do WhatsApp" }, { status: 409 })
      const emoji = body.emoji ?? ""
      await provider.sendReaction({ id: m.message_id, fromMe: m.direction === "out", remoteJid: m.jid }, emoji)
      await pool.query(
        `UPDATE wa_messages SET reactions = CASE WHEN $2 = '' THEN COALESCE(reactions, '{}'::jsonb) - 'eu'
                ELSE COALESCE(reactions, '{}'::jsonb) || jsonb_build_object('eu', $2::text) END,
                updated_at = NOW()
          WHERE id = $1`, [m.id, emoji])
      return NextResponse.json({ ok: true })
    }

    if (body.acao === "editar") {
      const texto = body.texto?.trim()
      if (!texto) return NextResponse.json({ error: "Texto vazio" }, { status: 400 })
      if (m.direction !== "out" || m.media_type || !m.message_id)
        return NextResponse.json({ error: "Só dá pra editar mensagem de texto enviada por nós" }, { status: 400 })
      if (Date.now() - new Date(m.created_at).getTime() > 15 * 60_000)
        return NextResponse.json({ error: "O WhatsApp só deixa editar até 15 minutos depois do envio" }, { status: 400 })
      // mantém a assinatura (*Nome* _função_) que o envio colocou na primeira linha
      const assinatura = m.content?.match(/^\*[^*\n]+\*(?: _[^_\n]+_)?\n/)?.[0] ?? ""
      const novo = assinatura + texto
      await provider.editMessage(numeroDe(m.jid), { id: m.message_id, fromMe: true, remoteJid: m.jid }, novo)
      await pool.query(`UPDATE wa_messages SET content = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1`, [m.id, novo])
      return NextResponse.json({ ok: true, content: novo })
    }

    if (body.acao === "encaminhar") {
      const { rows } = await pool.query<{ id: number; jid: string }>(
        `SELECT id, jid FROM wa_contacts WHERE id = $1`, [body.paraContactId ?? 0])
      const destino = rows[0]
      if (!destino) return NextResponse.json({ error: "Contato de destino não encontrado" }, { status: 404 })

      let evoId: string | null = null
      if (m.media_type && m.media_type !== "sticker") {
        // mídia: base64 guardado aqui ou a URL do arquivo (a Evolution aceita os dois)
        const media = m.media_data?.startsWith("data:") ? m.media_data.slice(m.media_data.indexOf(",") + 1) : m.media_url
        if (!media) return NextResponse.json({ error: "O arquivo dessa mensagem não está mais disponível" }, { status: 410 })
        const mimetype = m.media_data?.slice(5, m.media_data.indexOf(";")) || "application/octet-stream"
        const tipo = (["image", "video", "audio", "document"].includes(m.media_type) ? m.media_type : "document") as "image" | "video" | "audio" | "document"
        const r = await provider.sendMedia(numeroDe(destino.jid), {
          mediatype: tipo, mimetype, media, fileName: m.file_name ?? "arquivo", caption: m.caption ?? "",
        })
        evoId = r.id
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, media_type, media_data, media_url, file_name, caption, status)
           VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, $8, 'sent')
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [destino.id, evoId, m.caption || `[${tipo}]`, tipo, m.media_data, m.media_url, m.file_name, m.caption])
      } else {
        const texto = m.content?.trim()
        if (!texto) return NextResponse.json({ error: "Mensagem sem conteúdo pra encaminhar" }, { status: 400 })
        const raw = await sendWhatsApp(destino.jid, texto) as { key?: { id?: string } } | null
        evoId = raw?.key?.id ?? null
        await pool.query(
          `INSERT INTO wa_messages (contact_id, message_id, direction, content, status)
           VALUES ($1, $2, 'out', $3, 'sent')
           ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
          [destino.id, evoId, texto])
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
