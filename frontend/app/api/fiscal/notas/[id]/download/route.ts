import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const type = new URL(req.url).searchParams.get("type") === "xml" ? "xml" : "pdf"

    const { rows } = await pool.query(
      `SELECT xml, pdf, numero FROM fiscal_notes WHERE id = $1 AND status = 'autorizada'`,
      [id]
    )
    const note = rows[0]
    if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 })

    if (type === "xml") {
      if (!note.xml) return NextResponse.json({ error: "XML indisponível" }, { status: 404 })
      return new Response(note.xml, {
        headers: {
          "Content-Type": "application/xml",
          "Content-Disposition": `attachment; filename="NFe-${note.numero}.xml"`,
        },
      })
    }

    if (!note.pdf) return NextResponse.json({ error: "PDF indisponível" }, { status: 404 })
    return new Response(toArrayBuffer(Buffer.from(note.pdf, "base64")), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="NFe-${note.numero}.pdf"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
