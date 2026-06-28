import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import JSZip from "jszip"

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20) || "cliente"
}

function getExt(filename: string | null, mimeType: string | null): string {
  if (filename) {
    const parts = filename.split(".")
    if (parts.length > 1) return parts[parts.length - 1].toLowerCase()
  }
  if (mimeType) {
    const map: Record<string, string> = {
      "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
      "image/svg+xml": "svg", "application/pdf": "pdf",
      "image/webp": "webp", "image/tiff": "tif",
    }
    return map[mimeType] ?? mimeType.split("/")[1] ?? "bin"
  }
  return "bin"
}

// Handles both https:// URLs (Vercel Blob legacy) and data: base64 strings (PostgreSQL)
async function fetchFileBuffer(blobUrl: string): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  if (blobUrl.startsWith("data:")) {
    const comma = blobUrl.indexOf(",")
    if (comma === -1) return null
    const meta    = blobUrl.slice(5, comma)          // e.g. "image/png;base64"
    const b64     = blobUrl.slice(comma + 1)
    const mime    = meta.split(";")[0]
    const bytes   = Buffer.from(b64, "base64")
    return { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mimeType: mime }
  }
  try {
    const res = await fetch(blobUrl)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream"
    return { buffer, mimeType }
  } catch {
    return null
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const pedidoRes = await pool.query(`
      SELECT p.id, p.number, p.data,
             c.name AS "contactName"
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!pedidoRes.rows[0])
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })

    const pedido = pedidoRes.rows[0]

    const attRes = await pool.query(`
      SELECT a.id,
             COALESCE(a.blob_url, wm.media_data) AS "blobUrl",
             COALESCE(a.filename, wm.file_name)  AS filename,
             a.mime_type                          AS "mimeType"
      FROM dtf_order_attachments a
      LEFT JOIN wa_messages wm ON wm.id = a.wa_message_id
      WHERE a.pedido_id = $1
      ORDER BY a.id ASC
    `, [id])

    const attachments = attRes.rows
    if (attachments.length === 0)
      return NextResponse.json({ error: "Nenhum arquivo no pedido" }, { status: 404 })

    const clienteSlug = slugify(pedido.contactName ?? "cliente")
    const dateStr: string = pedido.data
    const [year, month, day] = dateStr.split("-")
    void year
    const ddMM   = `${day}${month}`
    const prefix = `${clienteSlug}-${ddMM}`

    if (attachments.length === 1) {
      const att    = attachments[0]
      const result = await fetchFileBuffer(att.blobUrl)
      if (!result) return NextResponse.json({ error: "Falha ao ler arquivo" }, { status: 502 })
      const ext             = getExt(att.filename, att.mimeType ?? result.mimeType)
      const renamedFilename = `${prefix}-1.${ext}`
      return new Response(result.buffer, {
        headers: {
          "Content-Type": att.mimeType ?? result.mimeType,
          "Content-Disposition": `attachment; filename="${renamedFilename}"`,
        },
      })
    }

    const zip = new JSZip()
    for (let i = 0; i < attachments.length; i++) {
      const att    = attachments[i]
      const result = await fetchFileBuffer(att.blobUrl)
      if (!result) continue
      const ext             = getExt(att.filename, att.mimeType ?? result.mimeType)
      const renamedFilename = `${prefix}-${i + 1}.${ext}`
      zip.file(renamedFilename, result.buffer)
    }

    const zipUint8 = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
    const zipName  = `${prefix}-artes.zip`

    return new Response(zipUint8, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
