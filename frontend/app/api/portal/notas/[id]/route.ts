import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// PDF/XML da nota — só se pertencer a um pedido do próprio cliente logado.
// Rota separada da /api/fiscal/notas/[id]/download (staff-only, bloqueada
// pelo middleware pra quem não tem sessão de equipe) pra nunca precisar
// abrir essa pra acesso público.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const { id } = await params
    const type = new URL(req.url).searchParams.get("type") === "xml" ? "xml" : "pdf"

    const { rows } = await pool.query(`
      SELECT fn.xml, fn.pdf, fn.numero
      FROM fiscal_notes fn
      JOIN fiscal_note_orders fno ON fno.fiscal_note_id = fn.id
      JOIN orders o ON o.id = fno.order_id
      WHERE fn.id = $1 AND fn.status = 'autorizada' AND o.contact_id = $2
      LIMIT 1
    `, [id, session.contactId])
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })

    if (type === "xml") {
      if (!note.xml) return NextResponse.json({ error: "XML indisponível" }, { status: 404 })
      return new Response(note.xml, {
        headers: { "Content-Type": "application/xml", "Content-Disposition": `inline; filename="NFe-${note.numero}.xml"` },
      })
    }

    if (!note.pdf) return NextResponse.json({ error: "PDF indisponível" }, { status: 404 })
    return new Response(toArrayBuffer(Buffer.from(note.pdf, "base64")), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="NFe-${note.numero}.pdf"` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
