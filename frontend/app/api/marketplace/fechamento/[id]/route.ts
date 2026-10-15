import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { paraNumero, avisosDe } from "@/lib/mktFechamento"
import { lerFechamento, quemEsta } from "@/lib/mktFechamentoDb"

type Ctx = { params: Promise<{ id: string }> }
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

// campo da API → coluna (só os que a grade da aba Lançamentos edita)
const EDITAVEIS: Record<string, { col: string; inteiro?: boolean; vazioNull?: boolean }> = {
  pedidos: { col: "pedidos", inteiro: true },
  pecas: { col: "pecas", inteiro: true },
  vendas: { col: "vendas" },
  taxas: { col: "taxas" },
  cupom: { col: "cupom" },
  frete: { col: "frete" },
  ads: { col: "ads" },
  custo: { col: "custo", vazioNull: true },
  pedidosUpseller: { col: "pedidos_upseller", inteiro: true, vazioNull: true },
  repasse: { col: "repasse", vazioNull: true },
}

// PUT /api/marketplace/fechamento/:id → corrige só os campos enviados. Vira origem "manual".
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return erro("id inválido")
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return erro("corpo JSON inválido") }
  if (!b || typeof b !== "object") return erro("corpo JSON inválido")

  const sets: string[] = []
  const args: unknown[] = []
  for (const [k, def] of Object.entries(EDITAVEIS)) {
    if (!(k in b)) continue
    const n = paraNumero(b[k])
    if (n === null) {
      if (!def.vazioNull) return erro(`${k} não pode ficar vazio`)
      args.push(null)
    } else {
      if (Number.isNaN(n)) return erro(`${k} não é número`)
      if (def.inteiro && (!Number.isInteger(n) || n < 0)) return erro(`${k} deve ser inteiro e não negativo`)
      args.push(def.inteiro ? n : Math.abs(n))
    }
    sets.push(`${def.col} = $${args.length}`)
  }
  if ("observacao" in b) {
    args.push(b.observacao === null ? null : String(b.observacao).trim() || null)
    sets.push(`observacao = $${args.length}`)
  }
  if (!sets.length) return erro("nenhum campo pra atualizar")

  try {
    args.push(await quemEsta())
    sets.push(`atualizado_por = $${args.length}`)
    args.push(Number(id))
    const { rowCount } = await pool.query(
      `UPDATE marketplace_fechamentos SET ${sets.join(", ")}, origem = 'manual', updated_at = now() WHERE id = $${args.length}`, args)
    if (!rowCount) return erro("lançamento não encontrado", 404)
    const f = (await lerFechamento(pool, Number(id)))!
    return NextResponse.json({ ok: true, fechamento: { ...f, avisos: avisosDe(f) } })
  } catch (e) {
    return erro(e instanceof Error ? e.message : String(e), 500)
  }
}

// DELETE /api/marketplace/fechamento/:id → apaga o dia + loja e os itens dele (o robô pode lançar de novo)
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return erro("id inválido")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query("DELETE FROM marketplace_fechamentos WHERE id = $1 RETURNING dia, loja", [Number(id)])
    if (!rows[0]) { await client.query("ROLLBACK"); return erro("lançamento não encontrado", 404) }
    await client.query("DELETE FROM marketplace_vendas_itens WHERE dia = $1 AND loja = $2", [rows[0].dia, rows[0].loja])
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    return erro(e instanceof Error ? e.message : String(e), 500)
  } finally {
    client.release()
  }
}
