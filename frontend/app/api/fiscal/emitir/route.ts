import { NextResponse } from "next/server"
import { emitirNotaFiscal } from "@/lib/fiscal/emitirNota"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const orderIds: number[] = Array.isArray(body.orderIds)
      ? body.orderIds
      : body.orderId ? [body.orderId] : []

    const result = await emitirNotaFiscal(orderIds)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: "detail" in result ? result.detail : undefined }, { status: result.httpStatus })
    }
    return NextResponse.json({ ok: true, ref: result.ref, status: result.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
