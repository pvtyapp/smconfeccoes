import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { COLUNAS, SELECT_DEVOLUCAO, validarCampos } from "@/lib/devolucoes"

type Ctx = { params: Promise<{ id: string }> }

const idValido = (id: string) => /^\d+$/.test(id)

// PUT /api/devolucoes/:id → atualiza só os campos enviados (ex.: {"situacao":"Reservada","pedidoReservado":"UP8EKT021082"})
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  if (!idValido(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: "corpo JSON inválido" }, { status: 400 }) }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "corpo JSON inválido" }, { status: 400 })

  const r = validarCampos(body)
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 })
  const campos = Object.keys(r.valores)
  if (!campos.length) return NextResponse.json({ error: "nenhum campo pra atualizar" }, { status: 400 })

  try {
    const sets = campos.map((k, i) => `${COLUNAS[k]} = $${i + 1}`)
    const { rows } = await pool.query(
      `UPDATE devolucoes SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${campos.length + 1} AND deleted_at IS NULL
       RETURNING ${SELECT_DEVOLUCAO}`,
      [...campos.map(k => r.valores[k]), Number(id)])
    if (!rows[0]) return NextResponse.json({ error: "devolução não encontrada" }, { status: 404 })
    return NextResponse.json({ ok: true, devolucao: rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("devolucoes_numero_sku_unico")) return NextResponse.json({ error: "já existe outra devolução com esse número e SKU" }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/devolucoes/:id → exclusão lógica (some da lista; o robô não recria pelo número+SKU)
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!idValido(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 })
  try {
    const { rowCount } = await pool.query(
      "UPDATE devolucoes SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL", [Number(id)])
    if (!rowCount) return NextResponse.json({ error: "devolução não encontrada" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
