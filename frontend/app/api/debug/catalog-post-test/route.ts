import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Debug temporário, NÃO destrutivo: roda a mesma lógica do POST /api/catalog
// (blob real + insert real) mas o insert vai numa transação com ROLLBACK no
// final — testa o caminho completo sem deixar produto de teste no catálogo.
export async function GET() {
  const client = await pool.connect()
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ ok: false, stage: "env", error: "sem token" })
    }
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const coverBlob = await put(`catalog/_debug-post-test-${Date.now()}.jpg`, tiny, { access: "public" })

    await client.query("BEGIN")
    const { rows } = await client.query(
      "INSERT INTO catalog_products (name, image_url, description, cover_color) VALUES ($1, $2, $3, $4) RETURNING id, name, image_url, display_order, description, cover_color, active",
      ["_debug produto teste", coverBlob.url, null, null]
    )
    await client.query("ROLLBACK")

    return NextResponse.json({ ok: true, wouldHaveInserted: rows[0], note: "rollback aplicado, nada foi salvo" })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    return NextResponse.json({ ok: false, error: msg, stack })
  } finally {
    client.release()
  }
}
