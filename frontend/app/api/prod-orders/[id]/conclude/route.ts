import { NextResponse } from "next/server"
import { concludeProdOrder } from "@/lib/prodOrders/concludeOrder"

// POST /api/prod-orders/[id]/conclude
// body: {
//   grade: { color, size, qty }[]
//   materials: { entryId, exhausted }[]
// }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }  = await params
    const { grade, materials } = await req.json()

    await concludeProdOrder(Number(id), grade, materials ?? [])
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("obrigatório") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
