import { NextResponse } from "next/server"
import { createRawMaterialVariant } from "@/lib/rawMaterials/createVariant"

export async function POST(req: Request) {
  try {
    const { materialId, name, autoDestock, minQty } = await req.json()
    const variant = await createRawMaterialVariant(materialId, name, autoDestock ?? false, minQty ?? null)
    return NextResponse.json({ ...variant, lots: [] }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("obrigatórios") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
