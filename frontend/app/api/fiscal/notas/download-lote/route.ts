import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import JSZip from "jszip"

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    const conditions: string[] = [`status = 'autorizada'`]
    const params: unknown[] = []
    if (from) { params.push(from); conditions.push(`criado_em >= $${params.length}::date`) }
    if (to)   { params.push(to);   conditions.push(`criado_em < $${params.length}::date + INTERVAL '1 day'`) }

    const { rows } = await pool.query(
      `SELECT numero, xml, pdf FROM fiscal_notes WHERE ${conditions.join(" AND ")} ORDER BY numero::int`,
      params
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: "Nenhuma nota autorizada nesse período" }, { status: 404 })
    }

    const zip = new JSZip()
    for (const r of rows) {
      if (r.xml) zip.file(`NFe-${r.numero}.xml`, r.xml)
      if (r.pdf) zip.file(`NFe-${r.numero}.pdf`, Buffer.from(r.pdf, "base64"))
    }
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })

    return new Response(toArrayBuffer(zipBuf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="notas-fiscais-${from ?? "todas"}-a-${to ?? "hoje"}.zip"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
