import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"

export type FocusNfeResultado = {
  status: string
  status_sefaz?: string
  mensagem_sefaz?: string
  chave_nfe?: string
  numero?: string
  serie?: string
  protocolo?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
}

// Compartilhado entre o webhook (chamado pela Focus NFe) e a checagem ativa
// (chamada pelo nosso sistema quando o webhook demora ou não chega) — mesma
// lógica de autorizar/rejeitar uma nota, não importa quem descobriu o resultado.
export async function processarResultadoNota(
  note: { id: number; ambiente: string },
  data: FocusNfeResultado
) {
  if (data.status !== "autorizado") {
    await pool.query(
      `UPDATE fiscal_notes SET status = 'rejeitada', motivo_rejeicao = $1 WHERE id = $2`,
      [`${data.status_sefaz ?? ""}: ${data.mensagem_sefaz ?? data.status}`, note.id]
    )
    return { status: "rejeitada" as const }
  }

  const { rows: settingsRows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key LIKE 'fiscal_%'`
  )
  const s: Record<string, string> = {}
  for (const r of settingsRows) s[r.key] = r.value
  const token = note.ambiente === "producao" ? s.fiscal_token_producao : s.fiscal_token_homologacao
  const baseUrl = note.ambiente === "producao"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br"
  const auth = `Basic ${Buffer.from(`${token}:`).toString("base64")}`

  const [xmlRes, pdfRes] = await Promise.all([
    fetch(`${baseUrl}${data.caminho_xml_nota_fiscal}`, { headers: { Authorization: auth } }),
    fetch(`${baseUrl}${data.caminho_danfe}`, { headers: { Authorization: auth } }),
  ])
  const xml = await xmlRes.text()
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())
  const pdfBase64 = pdfBuffer.toString("base64")

  await pool.query(`
    UPDATE fiscal_notes SET
      status = 'autorizada',
      chave_acesso = $1,
      numero = $2,
      serie = $3,
      protocolo = $4,
      xml = $5,
      pdf = $6,
      autorizado_em = NOW(),
      enviado_email_em = NOW()
    WHERE id = $7
  `, [data.chave_nfe, data.numero, data.serie, data.protocolo, xml, pdfBase64, note.id])

  // Nota pode cobrir vários pedidos consolidados — todos garantidamente do
  // mesmo cliente (validado na emissão), então qualquer um serve pra achar
  // o contato.
  try {
    const { rows: contactRows } = await pool.query(`
      SELECT c.jid, COALESCE(c.nome_cadastro, c.name) AS name
      FROM fiscal_note_orders fno
      JOIN orders o ON o.id = fno.order_id
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE fno.fiscal_note_id = $1
      LIMIT 1
    `, [note.id])
    const contact = contactRows[0]
    if (contact?.jid) {
      const number = contact.jid.endsWith("@lid")
        ? contact.jid
        : contact.jid.replace("@s.whatsapp.net", "").replace(/:[0-9]+$/, "")
      const provider = await getProvider()
      await provider.sendMedia(number, {
        mediatype: "document",
        media: pdfBase64,
        mimetype: "application/pdf",
        fileName: `NFe-${data.numero}.pdf`,
        caption: `Segue sua nota fiscal, ${(contact.name ?? "").split(" ")[0] || "obrigado pela compra"}!`,
      })
      await pool.query(`UPDATE fiscal_notes SET enviado_whatsapp_em = NOW() WHERE id = $1`, [note.id])
    }
  } catch (err) {
    // Nota já autorizada e salva — falha no envio de WhatsApp não desfaz
    // isso, só fica sem o timestamp.
    console.error("[fiscal] falha ao enviar WhatsApp:", err instanceof Error ? err.message : err)
  }

  return { status: "autorizada" as const }
}
