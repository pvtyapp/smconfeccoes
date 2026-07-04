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

// Returns a Node.js Buffer (Uint8Array subclass) — JSZip handles "nodebuffer" natively
async function fetchFileBuffer(blobUrl: string | null): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!blobUrl) return null

  if (blobUrl.startsWith("data:")) {
    const comma = blobUrl.indexOf(",")
    if (comma === -1) return null
    const meta  = blobUrl.slice(5, comma)   // e.g. "image/png;base64"
    const b64   = blobUrl.slice(comma + 1)
    const mime  = meta.split(";")[0]
    return { buffer: Buffer.from(b64, "base64"), mimeType: mime }
  }

  // Legacy https:// Vercel Blob URL
  try {
    const res = await fetch(blobUrl)
    if (!res.ok) return null
    const arrayBuf = await res.arrayBuffer()
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream"
    return { buffer: Buffer.from(arrayBuf), mimeType }
  } catch {
    return null
  }
}

// Extracts a concrete ArrayBuffer from a Buffer (needed for new Response())
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
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
             COALESCE(wm.media_data, a.blob_url) AS "blobUrl",
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
    const dateStr     = String(pedido.data ?? "")
    const parts       = dateStr.split("-")
    const day         = parts[2]?.slice(0, 2) ?? "00"
    const month       = parts[1] ?? "00"
    const ddMM        = `${day}${month}`
    const prefix      = `${clienteSlug}-${ddMM}`

    if (attachments.length === 1) {
      const att    = attachments[0]
      const result = await fetchFileBuffer(att.blobUrl)
      if (!result)
        return NextResponse.json({ error: "Arquivo não encontrado (mídia expirada)" }, { status: 404 })
      const ext             = getExt(att.filename, att.mimeType ?? result.mimeType)
      const renamedFilename = `${prefix}-1.${ext}`
      return new Response(toArrayBuffer(result.buffer), {
        headers: {
          "Content-Type": att.mimeType ?? result.mimeType,
          "Content-Disposition": `attachment; filename="${renamedFilename}"`,
        },
      })
    }

    const zip = new JSZip()
    let addedFiles = 0
    for (let i = 0; i < attachments.length; i++) {
      const att    = attachments[i]
      const result = await fetchFileBuffer(att.blobUrl)
      if (!result) continue
      const ext             = getExt(att.filename, att.mimeType ?? result.mimeType)
      const renamedFilename = `${prefix}-${i + 1}.${ext}`
      // Pass Buffer directly — JSZip detects as "nodebuffer" and handles natively
      zip.file(renamedFilename, result.buffer)
      addedFiles++
    }

    if (addedFiles === 0)
      return NextResponse.json({ error: "Arquivos não encontrados (mídia expirada)" }, { status: 404 })

    // Use "nodebuffer" output — avoids the JSZip arraybuffer DataWorker bug
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    const zipName = `${prefix}-artes.zip`

    return new Response(toArrayBuffer(zipBuf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
