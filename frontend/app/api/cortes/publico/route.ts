import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { criarCorte } from "@/lib/cortes"
import { getSessionFromRequest } from "@/lib/session"
import type { CorCorte } from "@/lib/cortesCalc"

// Tela do cortador terceirizado (/corte) — sem login, só o domínio (PIV 14/11).
// GET: produtos que dá pra cortar (nome, tamanhos, cores; nada de preço).
// POST: lança o corte e avisa o grupo SM Administrativo.
export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT id::text AS id, name, COALESCE(size_list,'{}') AS sizes, COALESCE(color_list,'{}') AS colors
        FROM products
       WHERE status = 'active' AND COALESCE(array_length(size_list,1),0) > 0 AND COALESCE(array_length(color_list,1),0) > 0
       ORDER BY name
    `)
    return NextResponse.json({ produtos: rows })
  } catch (e) {
    console.error("[cortes/publico] GET", e)
    return NextResponse.json({ error: "Não consegui carregar os produtos" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cortador?: string; productId?: string; cores?: CorCorte[]; teste?: boolean }
    // teste sem aviso no grupo: só pra quem está logado no painel
    const silencioso = body.teste === true && !!(await getSessionFromRequest().catch(() => null))
    const corte = await criarCorte({ cortador: body.cortador ?? "", productId: body.productId ?? "", cores: body.cores ?? [] }, { silencioso })
    return NextResponse.json({ ok: true, codigo: corte.codigo, id: corte.id, silencioso })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro"
    const conhecido = /^(Produto|Falta|Escolha|Cor fora|Quantidade|Peso|A sobra)/.test(msg)
    if (!conhecido) console.error("[cortes/publico] POST", e)
    return NextResponse.json({ error: conhecido ? msg : "Não consegui enviar, tenta de novo" }, { status: conhecido ? 400 : 500 })
  }
}
