import { put } from "@vercel/blob"
import { NextResponse } from "next/server"

// Debug temporário: testa só o upload pro Vercel Blob (sem tocar no banco), pra
// isolar se o erro de "subir produto" é no blob ou em outro ponto da rota.
export async function GET() {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ ok: false, stage: "env", error: "BLOB_READ_WRITE_TOKEN não configurado" })
    }
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]) // JPEG mínimo válido (SOI+EOI)
    const blob = await put(`catalog/_debug-test-${Date.now()}.jpg`, tiny, { access: "public" })
    return NextResponse.json({ ok: true, url: blob.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    return NextResponse.json({ ok: false, stage: "blob-put", error: msg, stack })
  }
}
