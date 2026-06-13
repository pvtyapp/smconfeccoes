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
      SELECT id, blob_url AS "blobUrl", filename, mime_type AS "mimeType"
      FROM dtf_order_attachments
      WHERE pedido_id = $1
      ORDER BY id ASC
    `, [id])

    const attachments = attRes.rows
    if (attachments.length === 0)
      return NextResponse.json({ error: "Nenhum arquivo no pedido" }, { status: 404 })

    // Build rename prefix: {slug-nome}-{ddMM}
    const clienteSlug = slugify(pedido.contactName ?? "cliente")
    const dateStr: string = pedido.data
    const [year, month, day] = dateStr.split("-")
    void year
    const ddMM = `${day}${month}`
    const prefix = `${clienteSlug}-${ddMM}`

    if (attachments.length === 1) {
      // Single file: proxy with renamed Content-Disposition
      const att = attachments[0]
      const ext = getExt(att.filename, att.mimeType)
      const renamedFilename = `${prefix}-1.${ext}`

      const blob = await fetch(att.blobUrl)
      if (!blob.ok) return NextResponse.json({ error: "Falha ao baixar arquivo" }, { status: 502 })

      const buffer = await blob.arrayBuffer()
      return new Response(buffer, {
        headers: {
          "Content-Type": att.mimeType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${renamedFilename}"`,
        },
      })
    }

    // Multiple files: build ZIP
    const zip = new JSZip()

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]
      const ext = getExt(att.filename, att.mimeType)
      const renamedFilename = `${prefix}-${i + 1}.${ext}`

      try {
        const blob = await fetch(att.blobUrl)
        if (!blob.ok) continue
        const buffer = await blob.arrayBuffer()
        zip.file(renamedFilename, buffer)
      } catch { /* skip failed file */ }
    }

    const zipUint8 = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
    const zipName = `${prefix}-artes.zip`

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
