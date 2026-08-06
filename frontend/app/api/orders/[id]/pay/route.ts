import { NextResponse } from "next/server"
import { payOrder } from "@/lib/receivables/payReceivable"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { method, notes, notifyClient, amount } = body as {
      method?: string; notes?: string; notifyClient?: boolean; amount?: number
    }

    const result = await payOrder(Number(id), amount, { method, notes, notifyClient, actor: "dashboard" })
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
