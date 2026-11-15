import { NextResponse } from "next/server"
import { aprovarCorte, cancelarCorte } from "@/lib/cortes"
import { getSessionFromRequest } from "@/lib/session"
import { lerDecimal, type MalhaCorte } from "@/lib/cortesCalc"

// Aprovar (preço do kg, largura, gramatura) ou cancelar um corte. Precisa de login.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    acao?: "aprovar" | "cancelar"
    precoKg?: number | string; largura?: number | string; gramatura?: number | string
    porCor?: boolean; precoCor?: Record<string, number | string | null>; maoCorte?: number | string | null
    teste?: boolean
  }
  try {
    if (body.acao === "cancelar") {
      await cancelarCorte(Number(id))
      return NextResponse.json({ ok: true })
    }
    const pos = (v: unknown) => { const n = lerDecimal(v as string); return n > 0 ? n : null }
    const malha: MalhaCorte = {
      precoKg: pos(body.precoKg), largura: pos(body.largura), gramatura: pos(body.gramatura),
      porCor: Boolean(body.porCor),
      precoCor: Object.fromEntries(Object.entries(body.precoCor ?? {}).map(([k, v]) => [k, pos(v)])),
      maoCorte: pos(body.maoCorte),
    }
    const session = await getSessionFromRequest().catch(() => null)
    const corte = await aprovarCorte(Number(id), malha, session?.name ?? null, { silencioso: body.teste === true })
    return NextResponse.json({ ok: true, corte })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro"
    const conhecido = /^(C-\d+ |Falta |Corte não)/.test(msg)
    if (!conhecido) console.error("[cortes] PATCH", e)
    return NextResponse.json({ error: conhecido ? msg : "Não consegui salvar, tenta de novo" }, { status: conhecido ? 400 : 500 })
  }
}
