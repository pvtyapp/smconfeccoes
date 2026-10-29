import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { validarRegra } from "@/lib/mktFechamento"
import { carregarRegras, recalcularCustos, skusSemCusto } from "@/lib/mktFechamentoDb"
import { exigirFinanceiro } from "@/lib/acesso"

// Regras de custo do marketplace: prefixo do SKU → produtos da SM (soma do material_cost) + extra.
// Toda mudança recalcula o custo de todos os itens já lançados.

const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

// GET → { regras, produtos (pra escolher), semCusto (SKUs vendidos sem regra) }
export async function GET() {
  const semPermissao = await exigirFinanceiro()
  if (semPermissao) return semPermissao

  try {
    const [regras, produtos, semCusto] = await Promise.all([
      carregarRegras(),
      pool.query(`SELECT id, name, material_cost::float AS "materialCost" FROM products WHERE status = 'active' ORDER BY name`).then(r => r.rows),
      skusSemCusto(),
    ])
    return NextResponse.json({ regras, produtos, semCusto })
  } catch (e) {
    return erro(e instanceof Error ? e.message : String(e), 500)
  }
}

// POST → cria regra. POST {acao:"recalcular"} → só recalcula tudo (depois de mudar custo no cadastro de produto).
export async function POST(req: Request) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return erro("corpo JSON inválido") }
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    if (b?.acao !== "recalcular") {
      const r = validarRegra(b ?? {}, false)
      if ("error" in r) { await client.query("ROLLBACK"); return erro(r.error) }
      const x = r.valores
      await client.query(`INSERT INTO marketplace_custos (prefixo, nome, produtos, extra) VALUES ($1, $2, $3::uuid[], $4)`,
        [x.prefixo, x.nome, x.produtos, x.extra])
    }
    await recalcularCustos(client)
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    return erro(msg.includes("marketplace_custos_prefixo_key") ? "já existe uma regra com esse prefixo" : msg, msg.includes("prefixo_key") ? 400 : 500)
  } finally {
    client.release()
  }
}
