import { NextResponse } from "next/server"
import { getPublicCatalog } from "@/lib/catalog/getPublicCatalog"

export async function GET() {
  try {
    const products = await getPublicCatalog()
    return NextResponse.json(products)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
