import { NextResponse } from "next/server"
import { verificarPendentes } from "@/lib/fiscal/verificarNota"

// Vercel Cron: */2 * * * * — termina qualquer nota que ficou "processando"
// (autorizada na Sefaz mas sem PDF salvo/WhatsApp enviado), sem depender de
// ninguém estar com o Relatório de Vendas aberto (PIV 15/10).
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const resultado = await verificarPendentes()
    return NextResponse.json({ ok: true, resultado })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
