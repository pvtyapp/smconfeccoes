import { NextResponse } from "next/server"
import { getAcesso } from "@/lib/acesso"
import { precoMetroDtf } from "@/lib/dtfPreco"

// GET /api/dtf/preco — returns sale_price from the DTF product (single source of truth).
// Sem "ver preço": diz só se o produto existe (oculto: true); o servidor calcula o valor ao concluir.
export async function GET() {
  try {
    const dtf = await precoMetroDtf()
    if (!dtf) return NextResponse.json({ precoMetro: null }, { status: 200 })
    const acesso = await getAcesso()
    if (!acesso?.verPreco) return NextResponse.json({ precoMetro: null, oculto: true, productName: dtf.productName })
    return NextResponse.json(dtf)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
