import { NextResponse } from "next/server"
import { payDtfPedido } from "@/lib/receivables/payReceivable"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { notifyClient, method, notes, amount } = body as {
      notifyClient?: boolean; method?: string; notes?: string; amount?: number
    }

    const result = await payDtfPedido(Number(id), amount, { method, notes, notifyClient })
    if (result.skipped) return NextResponse.json({ success: true, skipped: true })
    return NextResponse.json({ success: true, isFull: result.isFull, remaining: result.remaining })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg === "Pedido não encontrado" ? 404
      : (msg === "Informe um valor válido" || msg.startsWith("Valor maior que o restante")) ? 400
      : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
