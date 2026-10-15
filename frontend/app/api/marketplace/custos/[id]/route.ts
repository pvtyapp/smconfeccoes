import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { recalcularCustos } from "@/lib/mktFechamentoDb"
import { validarRegra } from "@/lib/mktFechamento"

type Ctx = { params: Promise<{ id: string }> }
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

const COL: Record<string, string> = { prefixo: "prefixo", nome: "nome", produtos: "produtos", extra: "extra" }

// PUT /api/marketplace/custos/:id → muda a regra e recalcula o custo dos itens lançados
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return erro("id inválido")
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return erro("corpo JSON inválido") }
  const r = validarRegra(b ?? {}, true)
  if ("error" in r) return erro(r.error)
  const campos = Object.keys(r.valores)
  if (!campos.length) return erro("nenhum campo pra atualizar")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const sets = campos.map((k, i) => `${COL[k]} = $${i + 1}${k === "produtos" ? "::uuid[]" : ""}`)
    const { rowCount } = await client.query(
      `UPDATE marketplace_custos SET ${sets.join(", ")}, updated_at = now() WHERE id = $${campos.length + 1}`,
      [...campos.map(k => r.valores[k]), Number(id)])
    if (!rowCount) { await client.query("ROLLBACK"); return erro("regra não encontrada", 404) }
    await recalcularCustos(client)
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    return erro(msg.includes("prefixo_key") ? "já existe uma regra com esse prefixo" : msg, msg.includes("prefixo_key") ? 400 : 500)
  } finally {
    client.release()
  }
}

// DELETE /api/marketplace/custos/:id → apaga a regra; os itens dela ficam "sem custo"
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return erro("id inválido")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("DELETE FROM marketplace_custos WHERE id = $1", [Number(id)])
    await recalcularCustos(client)
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    return erro(e instanceof Error ? e.message : String(e), 500)
  } finally {
    client.release()
  }
}
