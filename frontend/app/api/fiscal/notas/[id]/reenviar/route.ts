import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Nota pode cobrir vários pedidos consolidados — todos do mesmo cliente
    // (validado na emissão), então LIMIT 1 já basta pra achar o contato.
    const { rows } = await pool.query(`
      SELECT fn.pdf, fn.numero, c.jid, COALESCE(c.nome_cadastro, c.name) AS name
      FROM fiscal_notes fn
      JOIN fiscal_note_orders fno ON fno.fiscal_note_id = fn.id
      JOIN orders o ON o.id = fno.order_id
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE fn.id = $1 AND fn.status = 'autorizada'
      LIMIT 1
    `, [id])
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada ou não autorizada" }, { status: 404 })
    if (!note.pdf) return NextResponse.json({ error: "PDF indisponível pra essa nota" }, { status: 404 })
    if (!note.jid) return NextResponse.json({ error: "Cliente sem WhatsApp cadastrado" }, { status: 400 })

    const number = note.jid.endsWith("@lid")
      ? note.jid
      : note.jid.replace("@s.whatsapp.net", "").replace(/:[0-9]+$/, "")

    const provider = await getProvider()
    await provider.sendMedia(number, {
      mediatype: "document",
      media: note.pdf,
      mimetype: "application/pdf",
      fileName: `NFe-${note.numero}.pdf`,
      caption: `Segue sua nota fiscal, ${(note.name ?? "").split(" ")[0] || "obrigado pela compra"}!`,
    })
    await pool.query(`UPDATE fiscal_notes SET enviado_whatsapp_em = NOW() WHERE id = $1`, [id])

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
