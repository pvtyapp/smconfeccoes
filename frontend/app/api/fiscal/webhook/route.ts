import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"

// Focus NFe chama esse endpoint quando termina de processar uma nota
// (autorizada ou rejeitada) — configurado na aba Webhooks do Painel API.
// Formato do corpo é o mesmo do GET /v2/nfe/{ref} (testado manualmente em
// homologação antes de virar código).
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { ref, status, status_sefaz, mensagem_sefaz, chave_nfe, numero, serie, protocolo,
             caminho_xml_nota_fiscal, caminho_danfe } = body

    if (!ref) return NextResponse.json({ error: "ref ausente" }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT id, order_id AS "orderId", ambiente FROM fiscal_notes WHERE ref = $1`,
      [ref]
    )
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })

    if (status !== "autorizado") {
      await pool.query(
        `UPDATE fiscal_notes SET status = 'rejeitada', motivo_rejeicao = $1 WHERE id = $2`,
        [`${status_sefaz ?? ""}: ${mensagem_sefaz ?? status}`, note.id]
      )
      return NextResponse.json({ ok: true })
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
      fetch(`${baseUrl}${caminho_xml_nota_fiscal}`, { headers: { Authorization: auth } }),
      fetch(`${baseUrl}${caminho_danfe}`, { headers: { Authorization: auth } }),
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
    `, [chave_nfe, numero, serie, protocolo, xml, pdfBase64, note.id])

    // Envia o DANFE por WhatsApp pro contato do pedido — reusa o sendMedia já
    // existente na Evolution API (mediatype "document"), sem infra nova.
    try {
      const { rows: contactRows } = await pool.query(`
        SELECT c.jid, COALESCE(c.nome_cadastro, c.name) AS name
        FROM orders o JOIN wa_contacts c ON c.id = o.contact_id
        WHERE o.id = $1
      `, [note.orderId])
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
          fileName: `NFe-${numero}.pdf`,
          caption: `Segue sua nota fiscal, ${(contact.name ?? "").split(" ")[0] || "obrigado pela compra"}!`,
        })
        await pool.query(`UPDATE fiscal_notes SET enviado_whatsapp_em = NOW() WHERE id = $1`, [note.id])
      }
    } catch { /* nota já autorizada e salva — falha no envio de WhatsApp não desfaz isso, só fica sem o timestamp */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
